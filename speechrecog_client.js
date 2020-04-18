const sip = require('sip')
const config = require('config')

const utils = require('./utils')

const args = require('yargs').argv

const RtpSession = require('rtp-session')

const mrcp = require('mrcp')

const fs = require('fs')

const usage = () => {
	console.log(`
Usage: node ${args.$0} server_sip_host server_sip_port
Ex:    node ${args.$0} 127.0.0.1 8060

`)
}


if(args._.length != 2) {
	console.error("Invalid number of arguments")
	usage()
	process.exit(1)
}

const server_sip_host = args._[0]
const server_sip_port = args._[1]

const resource_type = 'speechrecog'

args['language'] = 'ja-JP'

const local_ip = config.local_ip ? config.local_ip : "0.0.0.0"
const local_sip_port = config.local_sip_port ? config.local_sip_port : 5090
const local_rtp_port = config.local_rtp_port ? config.local_rtp_port : 10000

const dialogs = {}

const fd = fs.openSync("./artifacts/ohayou_gozaimasu.r-8000.e-mu-law.b-16.c-1.raw", "r")
console.log(fd)

var buffer = new Buffer(160)

const sip_stack = sip.create({
		address: local_ip,
		port: local_sip_port,
	},

	(req) => {
		// We don't accept incoming calls
		sip_stack.send(sip.makeResponse(rq, 405, "Method not allowed"))
	}
)


const rtp_session = new RtpSession({})
rtp_session.on('error', (err) => {
	console.error(err)
	process.exit(1)
})


rtp_session.set_local_end_point(local_ip, local_rtp_port)

const sip_uri = `sip:${server_sip_host}:${server_sip_port}`

sip_stack.send(
	{
		method: 'INVITE',
		uri: sip_uri,
		headers: {
			to: {uri: sip_uri},
			from: {uri: `sip:mrcp_client@${local_ip}:${local_sip_port}`, params: {tag: utils.rstring()}},
			'call-id': utils.rstring(),
			cseq: {method: 'INVITE', seq: Math.floor(Math.random() * 1e5)},
			'content-type': 'application/sdp',
			contact: [{uri: `sip:mrcp_client@${local_ip}:${local_sip_port}`}],
		},
		content: utils.gen_sdp(resource_type, local_ip, local_rtp_port),
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

			console.log("P1")

			// sending ACK
			sip_stack.send({
				method: 'ACK',
				uri: rs.headers.contact[0].uri,
				headers: {
					to: rs.headers.to,
					from: rs.headers.from,
					'call-id': rs.headers['call-id'],
					cseq: {method: 'ACK', seq: rs.headers.cseq.seq},
					via: []
				}
			})

			console.log("P2")
			var id = [rs.headers['call-id'], rs.headers.from.params.tag, rs.headers.to.params.tag].join(':')

			console.log("P3")
			// registering our 'dialog' which is just function to process in-dialog requests

			try {
				if(!dialogs[id]) {
					dialogs[id] = function(rq) {
						if(rq.method === 'BYE') {
							console.log('call received bye')

							delete dialogs[id]

							sip_stack.send(sip.makeResponse(rq, 200, 'Ok'))
						} else {
							sip_stack.send(sip.makeResponse(rq, 405, 'Method not allowed'))
						}
					}
				}
			} catch(e) {
				console.error(e)
			}

			console.log("P4")
			var data = {}

			try {
				var answer_sdp = utils.parse_sdp(rs.content)
				console.log(answer_sdp)
				if(!utils.sdp_matcher(answer_sdp, data)) {
					console.error("Could not get correct SDP answer")
					process.exit(1)
				}

				rtp_session.set_remote_end_point(data.remote_ip, data.remote_rtp_port)

				var client = mrcp.createClient({
					host: data.remote_ip,
					port: data.remote_mrcp_port,
				})

				var request_id = 1

				var msg = utils.build_mrcp_request('RECOGNIZE', request_id, data.channel, args)
				console.log('Sending MRCP requests. result: ', client.write(msg))
				request_id++

				client.on('error', (err) => {
					console.error(err)
					process.exit(1)
				})

				client.on('close', () => { console.log('mrcp client closed') })

				client.on('data', data => {
					console.log('***********************************************')
					console.log('mrcp on data:')
					console.log(data)
					console.log()

					var tid

					if(data.type == 'response' && data.status_code == 200) { 
						tid = setInterval(() => {
							fs.read(fd, buffer, 0, 160, null, (err, bytesRead, data) => {
								if(err) {
									console.error(err)
									clearInterval(tid)
									tid = null
								} else if(bytesRead == 0) {
									console.log("no more data")
									clearInterval(tid)
									for(i=0 ;i<160; i++) {
										buffer[i] = 0x7F
									}
									tid = setInterval(() => {
										//console.log("sending silence")	
										rtp_session.send_payload(buffer, 0, 0) 	
									}, 20)
								} else {
									console.log(`got ${bytesRead} bytes:`)
									console.log(data)
									rtp_session.send_payload(buffer, 0, 0) 	
								}
							})
						}, 20)
					} else if (data.type == 'event' && data.event_name == 'RECOGNITION-COMPLETE') {
						if(tid) {
							clearInterval(tid)
							tid = null
						}
					}

				})
			} catch(e) {
				console.error(`Failure when process answer SDP: ${e}`)
				process.exit(1)
			}
		}
	}
)
