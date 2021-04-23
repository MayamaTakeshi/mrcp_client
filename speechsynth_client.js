const sip = require('sip')
const config = require('config')
const fs = require('fs')
const _ = require('lodash')
const deasyncPromise = require('deasync-promise')
const mrcp = require('mrcp')
const mrcp_utils = require('mrcp-utils')

const FileWriter = require('wav').FileWriter

const utils = require('./utils')
const lu = require('./linear_ulaw')

const args = require('yargs').boolean('S').argv

const uuid = require('uuid')

const usage = () => {
    console.log(`
Usage:    node ${args.$0} [-w output_file] [-t timeout] [-S] server_sip_host server_sip_port language voice text_or_file

Examples: node ${args.$0} 127.0.0.1 8070 ja-JP ja-JP-Wavenet-A "おはようございます."
          node ${args.$0} 127.0.0.1 8070 ja-JP ja-JP-Wavenet-A @some_file.txt

Details:
          -w output_file: indicates if received speech should be written to a wav file 
          -t timeout: timeout in milliseconds to wait for operation to complete 
          -S: disable playing audio to speaker (necessary if you are using a machine without audio device)      
          text_or_file: the text to be converted to speech. If it starts with @, it will indicate a file containing the text to be converted.
`)
}


if(args._.length != 5) {
    console.log(args._)
    console.error("Invalid number of arguments")
    usage()
    process.exit(1)
}

const server_sip_host = args._[0]
const server_sip_port = args._[1]
const language = args._[2]
const voice = args._[3]
var text = args._[4].toString() // it seems args converts numeric strings to numbers. So we need to force text to stay as string.

console.log(`language: ${language}`)
console.log(`voice: ${voice}`)
console.log(`text: ${text}`)

if(text.startsWith("@")) {
    const file_name = text.substr(1)
    text = fs.readFileSync(file_name, "utf-8")
}

const resource_type = 'speechsynth'

const call_id = uuid.v4()

args['language'] = language
args['voice'] = voice
args['text'] = text

var local_ip = config.local_ip ? config.local_ip : "0.0.0.0"
var local_sip_port = config.local_sip_port
var local_rtp_port = config.local_rtp_port


const rtp_session = utils.alloc_rtp_session(local_rtp_port, local_ip)
if(!rtp_session) {
    console.error("Failed to allocate rtp_session")
    process.exit(1)
}


local_rtp_port = rtp_session._info.local_port

var output_file = null

const terminate = (status) => {
    if(output_file) {
        setTimeout(() => {
            output_file.end(res => {
                process.exit(status)
            })
        }, 1000)
    } else {
        setTimeout(() => {
            process.exit(status)
        }, 1000)
    }
}

    

rtp_session.on('error', (err) => {
    console.error(err)
    terminate(1)
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
            terminate(0)

            return
        }

        sip_stack.send(sip.makeResponse(req, 405, "Method not allowed"))
    }
)

const sip_uri = `sip:${server_sip_host}:${server_sip_port}`

if(args.w) {
    output_file = new FileWriter(args.w, {
        sampleRate: 8000,
        channels: 1,
        signed: true,
    })
}

if(args.t) {
    var timeout = parseInt(args.t)
    setTimeout(() => {
        console.log("timeout. Terminating")
        terminate(1)
    }, timeout)
}

var speaker = null
var buffer = null

if(!args.S) {
    console.log("Setting up speaker")

    const Speaker = require('speaker')
    speaker = new Speaker({
        audioFormat: 1,
        endianness: 'LE',
        channels: 1,
        sampleRate: 8000,
        byteRate: 16000,
        blockAlign: 2,
        bitDepth: 16,
        signed: true
    })

    buffer = []

    // add some initial silence to avoid speaker underflow
    for(var i=0 ; i<32 ; i++) {
        var buf = Buffer(new Array(320))
        buffer.push(buf)
    }
}

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
            console.log('call failed with status ' + rs.status)  
        }
        else if(rs.status < 200) {
            console.log('call progress status ' + rs.status)
        } else {
            // yes we can get multiple 2xx response with different tags
            console.log('call answered with tag ' + rs.headers.to.params.tag)

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
                    terminate(1)
                }

                rtp_session.set_remote_end_point(data.remote_ip, data.remote_rtp_port)

                rtp_session.on('data', payload => {
                    //console.log('rtp packet')

                    var buf = Buffer.alloc(payload.length * 2)

                    for(var i=0 ; i<payload.length ; i++) {
                        // convert ulaw to L16 little-endian
                        var l = lu.ulaw2linear(payload[i])
                        buf[i*2] = l & 0xFF
                        buf[i*2+1] = l >>> 8
                    }

                    if(speaker) {
                        buffer.push(buf)

                        var res = buffer.shift()

                        while(res) {
                            speaker.write(res)
                            res = buffer.shift()
                        }
                    }

                    if(output_file) {
                        output_file.write(buf)
                    }
                })

                var client = mrcp.createClient({
                    host: data.remote_ip,
                    port: data.remote_mrcp_port,
                })

                var request_id = 1

                var msg = utils.build_mrcp_request('SPEAK', request_id, data.channel, args)
                console.log('Sending MRCP requests. result: ', client.write(msg))
                request_id++

                client.on('error', (err) => {
                    console.error(err)
                    terminate(1)
                })

                client.on('close', () => { console.log('mrcp client closed') })

                client.on('data', data => {
                    console.log('***********************************************')
                    console.log('mrcp on data:')
                    console.log(data)
                    console.log()

                    if (data.type == 'response' && data.status_code == 200) {
                        console.log("command accepted")

                        // Simulating client disconnection during speak
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
                                    terminate(0)
                            })
                        }, 500)
                        */
                    } else if (data.type == 'event' && data.event_name == 'SPEAK-COMPLETE') {
                        // sending BYE
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
                                    terminate(0)
                            })
                        }, 500)
                    } else {
                        console.log("unexpected data")
                        console.dir(data)
                    }

                })
            } catch(e) {
                console.error(`Failure when process answer SDP: ${e}`)
                terminate(1)
            }
        }
    }
)
