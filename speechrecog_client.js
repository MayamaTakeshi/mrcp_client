const sip = require('sip')
const config = require('config')
const fs = require('fs')
const _ = require('lodash')
const deasyncPromise = require('deasync-promise')
const mrcp = require('mrcp')
const mrcp_utils = require('mrcp-utils')

const mic = require('mic')

var micInstance = null
var micInputStream = null

const utils = require('./utils')
const lu = require('./linear_ulaw')

const args = require('yargs').argv

const uuid = require('uuid')

const usage = () => {
    console.log(`
Usage: node ${args.$0} [-t timeout] [-r extra_recognize_headers] server_sip_host server_sip_port language audio_file grammar
    node ${args.$0} 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav @artifacts/grammar.xml 
    node ${args.$0} 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav builtin:speech/transcribe 
    node ${args.$0} 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav "builtin:speech/transcribe\\nbuiltin:dtmf/digits"
    node ${args.$0} 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav "builtin:speech/transcribe\\nbuiltin:dtmf/digits\\nbuiltin:speech/directory"
    node ${args.$0} -r "Recognition-Timeout: 5000\\nNo-Input-Timeout: 7000" 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav builtin:speech/transcribe 

Details:
    audio_file: wav file containing audio with speech to be recognized
    grammar: grammar(s) to be used or @xml_file containing grammar definition (hints)
    -t timeout: timeout in milliseconds to wait for the operation to complete
    -r extra_recognize_headers: extra headers to be added to message RECOGNIZE
`)
}


if(args._.length != 5) {
    console.error("Invalid number of arguments")
    usage()
    process.exit(1)
}

const server_sip_host = args._[0]
const server_sip_port = args._[1]
const language = args._[2]
const audio_file = args._[3]
var grammar = args._[4]

const resource_type = 'speechrecog'

const call_id = uuid.v4()

const content_id = uuid.v4()

args.content_id = content_id

const buffer = new Buffer.alloc(160)

var grammar_file = null

if(grammar.startsWith("@")) {
    grammar_file = grammar.slice(1)
    grammar = fs.readFileSync(grammar_file, {encoding:'utf8', flag:'r'})
} else {
    grammar = grammar.replace(/\\n/g, '\n')
}

var local_ip = config.local_ip ? config.local_ip : "0.0.0.0"
var local_sip_port = config.local_sip_port
var local_rtp_port = config.local_rtp_port

var extra_recognize_headers = {}

if(args.t) {
    var timeout = parseInt(args.t)
    setTimeout(() => {
        console.log("timeout. Terminating")
        process.exit(1)
    }, timeout)
}

if(args.r) {
    var tokens = args.r.split("\\n")
    for(var i=0 ; i<tokens.length ; i++) { 
        var token = tokens[i]
        var colon_pos = token.indexOf(":")
        if(colon_pos < 0) break
        var key = token.slice(0, colon_pos).trim()
        var val = token.slice(colon_pos + 1).trim()
        extra_recognize_headers[key] = val
    }
}

const rtp_session = utils.alloc_rtp_session(local_rtp_port, local_ip)
if(!rtp_session) {
    console.error("Failed to allocate rtp_session")
    process.exit(1)
}

local_rtp_port = rtp_session._info.local_port

rtp_session.on('error', (err) => {
    console.error(err)
    process.exit(1)
})

var free_sip_port = utils.find_free_sip_port(local_sip_port, local_ip)
if(!free_sip_port) {
    if(local_sip_port) {
        console.error(`config.local_sip_port=${local_sip_port} is already being used by another application`)
    } else {
        console.error(`Failed to find free UDP port for SIP stack`)
    }
    process.exit(1)
}

local_sip_port = free_sip_port

console.log(`Local  SIP address: ${local_ip}:${local_sip_port}`)

const sip_stack = sip.create({
        address: local_ip,
        port: local_sip_port,
    },

    (req) => {
        if(req['call-id'] != call_id) {
            console.log(`Received non-dialog ${req.method}`)
            sip_stack.send(sip.makeResponse(req, 481, "Call Leg/Transaction Does Not Exist"))
            return
        }

        if(req.method == 'BYE') {
            console.log('Got BYE')
            var res = sip.makeResponse(req, 200, 'OK')
            sip_stack.send(res)
            setTimeout(() => {
                process.exit(0)
            }, 1000)

            return
        }

        sip_stack.send(sip.makeResponse(req, 405, "Method not allowed"))
    }
)

const sip_uri = `sip:${server_sip_host}:${server_sip_port}`

console.log(`Remote SIP address: ${sip_uri}`)

sip_stack.send(
    {
        method: 'INVITE',
        uri: sip_uri,
        headers: {
            to: {uri: sip_uri},
            from: {uri: `sip:mrcp_client@${local_ip}:${local_sip_port}`, params: {tag: utils.rstring()}},
            'call-id': call_id,
            cseq: {method: 'INVITE', seq: Math.floor(Math.random() * 1e5)},
            'content-type': 'application/sdp',
            contact: [{uri: `sip:mrcp_client@${local_ip}:${local_sip_port}`}],
        },
        content: mrcp_utils.gen_offer_sdp(resource_type, local_ip, local_rtp_port),
    },
    function(rs) {
        console.log(rs)

        if(rs.status >= 300) {
            console.log('Call failed with status ' + rs.status)  
        }
        else if(rs.status < 200) {
            console.log('Call progress status ' + rs.status)
        } else {
            // yes we can get multiple 2xx response with different tags
            console.log('Call answered with tag ' + rs.headers.to.params.tag)

            // sending ACK
            sip_stack.send({
                method: 'ACK',
                uri: rs.headers.contact[0].uri,
                headers: {
                    to: rs.headers.to,
                    from: rs.headers.from,
                    'call-id': call_id,
                    cseq: {method: 'ACK', seq: rs.headers.cseq.seq},
                    via: []
                }
            })

            var data = {}

            try {
                var answer_sdp = mrcp_utils.parse_sdp(rs.content)
                console.log(answer_sdp)
                if(!mrcp_utils.answer_sdp_matcher(answer_sdp, data)) {
                    console.error("Could not get correct SDP answer")
                    process.exit(1)
                }

                rtp_session.set_remote_end_point(data.remote_ip, data.remote_rtp_port)

                var client = mrcp.createClient({
                    host: data.remote_ip,
                    port: data.remote_mrcp_port,
                })

                var request_id = 1

                client.on('error', (err) => {
                    console.error(err)
                    process.exit(1)
                })

                var define_grammar_request_id = null

                var recognize_request_id = null

                if(grammar_file) {
                    var define_grammar_msg = mrcp.builder.build_request('DEFINE-GRAMMAR', request_id, {
                        'channel-identifier': data.channel,
                        'content-id': content_id,
                        'content-type': 'application/xml',
                    }, grammar)

                    console.log('Sending MRCP DEFINE-GRAMMAR request. result: ', client.write(define_grammar_msg))
                    define_grammar_request_id = request_id
                    request_id++
                } else {
                    var recognize_msg = mrcp.builder.build_request('RECOGNIZE', request_id, _.extend({
                        'channel-identifier': data.channel,
                        'speech-language': language,
		                'content-type': 'text/uri-list',
                    }, extra_recognize_headers), grammar)

                    console.log('Sending MRCP RECOGNIZE request. result: ', client.write(recognize_msg))
                    recognize_request_id = request_id
                    request_id++
                }

                var tid

                client.on('close', () => { console.log('mrcp client closed') })

                client.on('data', d => {
                    console.log('***********************************************')
                    console.log(`${new Date()} mrcp on data:`)
                    console.log(d)
                    console.log()

                    if(d.type == 'response' && d.request_id == define_grammar_request_id && d.status_code == 200) { 
                        var recognize_msg = mrcp.builder.build_request('RECOGNIZE', request_id, _.extend({
                            'channel-identifier': data.channel,
                            'speech-language': language,
		                    'content-type': 'text/uri-list',
                        }, extra_recognize_headers), 'session:' + content_id)
                        console.log('Sending MRCP RECOGNIZE request. result: ', client.write(recognize_msg))
                        recognize_request_id = request_id
                        request_id++
                    } else if(d.type == 'response' && d.request_id == recognize_request_id && d.status_code == 200) { 
                        if(audio_file == 'MIC') {
                            var opts = {
                                rate: 8000,
                                channels: 1,
                                device: 'default',
                            }

                            micInstance = mic(opts)
                            micInputStream = micInstance.getAudioStream()
                            micInstance.start()

                            tid = setInterval(() => {
                                var buffer = micInputStream.read(320)
                                //console.log(`micInputStream buffer: ${buffer ? buffer.length : null}`)

                                if(buffer) {
                                    var buffer2 = Buffer.alloc(buffer.length/2)
                                    for(var i=0 ; i<buffer.length/2 ; i++) {
                                        var linear = (buffer[i*2]) + (buffer[i*2+1] << 8)
                                        var ulaw = lu.linear2ulaw(linear)
                                        buffer2[i] = ulaw
                                    }
                                    rtp_session.send_payload(buffer2, 0, 0)
                                }
                            }, 20)
                    
                        } else {
                            const { spawn } = require('child_process');
                            const ls = spawn('sox', [audio_file, "-r", "8000", "-t", "raw", "-e", "mu-law", "temp.raw"]);


                            // DEBUG CODE
                            /*
                            setTimeout(() => {
                                var msg = mrcp.builder.build_request('STOP', request_id+1, {
                                    'channel-identifier': data.channel,
                                })
                                console.log('Sending MRCP request. result: ', client.write(msg))
                            }, 100)
                            */

                            ls.stdout.on('data', (data) => {
                              console.log(`stdout: ${data}`);
                            });

                            ls.stderr.on('data', (data) => {
                              console.error(`stderr: ${data}`);
                            });

                            ls.on('close', (code) => {
                                console.log(`child process exited with code ${code}`);

                                const fd = fs.openSync("temp.raw", "r")

                                tid = setInterval(() => {
                                    fs.read(fd, buffer, 0, 160, null, (err, bytesRead, data) => {
                                        if(err) {
                                            console.error(err)
                                            clearInterval(tid)
                                            tid = null
                                        } else if(bytesRead == 0) {
                                            console.log(`${new Date()} No more data from file.`)
                                            clearInterval(tid)

                                            console.log("Sending silence from now on")
                                            for(i=0 ;i<160; i++) {
                                                //buffer[i] = 0x7F
                                                buffer[i] = 0xFF
                                            }

                                            tid = setInterval(() => {
                                                rtp_session.send_payload(buffer, 0, 0)     
                                            }, 20)
                                        } else {
                                            console.log(`${new Date()} Fetched ${bytesRead} bytes from audio_file. Sending to MRCP server.`)
                                            //console.log(data)
                                            rtp_session.send_payload(buffer, 0, 0)     
                                        }
                                    })
                                }, 20)
                            })
                        }

                        // Simulating client disconnection during recognition
                        /*
                        setTimeout(() => {
                            sip_stack.send({
                                method: 'BYE',
                                uri: rs.headers.contact[0].uri,
                                headers: {
                                    to: rs.headers.to,
                                    from: rs.headers.from,
                                    'call-id': call_id,
                                    cseq: {method: 'BYE', seq: rs.headers.cseq.seq + 1},
                                    via: []
                                }
                            }, (res) => {
                                    console.log(`BYE got: ${res.status} ${res.reason}`)    
                                    process.exit(0)
                            })
                        }, 500)
                        */
                    } else if (d.type == 'event' && d.event_name == 'RECOGNITION-COMPLETE') {
                        if(tid) {
                            clearInterval(tid)
                            tid = null
                        }

                        // sending BYE
                        sip_stack.send({
                            method: 'BYE',
                            uri: rs.headers.contact[0].uri,
                            headers: {
                                to: rs.headers.to,
                                from: rs.headers.from,
                                'call-id': call_id,
                                cseq: {method: 'BYE', seq: rs.headers.cseq.seq + 1},
                                via: []
                            }
                        }, (res) => {
                                console.log(`BYE got: ${res.status} ${res.reason}`)    
                                process.exit(0)
                        })
                    } else {
                        console.log("Unexpected data")
                    }

                })
            } catch(e) {
                console.error(`Failure when process answer SDP: ${e}`)
                process.exit(1)
            }
        }
    }
)
