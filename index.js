const sip = require('sip')
const config = require('config')

const utils = require('utils')

const args = require('yargs').argv


const usage = () => {
	console.log(`
Usage: node ${args.$0} resource_type server_host server_port
Ex:    node ${args.$0} synth 192.168.1.1 5060

Details:
  resource_type: synth | recog
`)
}


if(args._.length != 3) {
	console.error("Invalid number of arguments")
	usage()
	process.exit(1)
}

const resource_type = args._[0]
const server_host = args._[1]
const server_port = args._[2]


const local_ip = config.local_ip ? config.local_ip : "0.0.0.0"
const local_port = config.local_port ? config.local_port : 5090


const sip_stack = sip.create({
		address: local_ip,
		port: local_port,
	},

	(req) => {
		// We don't accept incoming calls
		sip_stack.send(sip.makeResponse(rq, 405, "Method not allowed"))
	}
)


const sip_uri = `sip:${server_host}:${server_port}`

sip.send(
	{
		method: 'INVITE',
		uri: sip_uri,
		headers: {
			to: {uri: sip_uri},
			from: {uri: `sip:mrcp_client@${local_ip}:${local_port}`, params: {tag: utils.rstring()}},
			'call-id': utils.rstring(),
			cseq: {method: 'INVITE', seq: Math.floor(Math.random() * 1e5)},
			'content-type': 'application/sdp',
			contact: [{uri: `sip:mrcp_client@${local_ip}:${local_port}`}],
		},
		content: utils.gen_sdp(resource_type, local_rtp_ip, local_rtp_port),
	},
	function(rs) {
		if(rs.status >= 300) {
			console.log('call failed with status ' + rs.status);  
		}
		else if(rs.status < 200) {
			console.log('call progress status ' + rs.status);
		} else {
			// yes we can get multiple 2xx response with different tags
			console.log('call answered with tag ' + rs.headers.to.params.tag);

			// sending ACK
			sip.send({
				method: 'ACK',
				uri: rs.headers.contact[0].uri,
				headers: {
					to: rs.headers.to,
					from: rs.headers.from,
					'call-id': rs.headers['call-id'],
					cseq: {method: 'ACK', seq: rs.headers.cseq.seq},
					via: []
				}
			});

			var id = [rs.headers['call-id'], rs.headers.from.params.tag, rs.headers.to.params.tag].join(':');

			// registring our 'dialog' which is just function to process in-dialog requests
			if(!dialogs[id]) {
				dialogs[id] = function(rq) {
					if(rq.method === 'BYE') {
						console.log('call received bye');

						delete dialogs[id];

						sip.send(sip.makeResponse(rq, 200, 'Ok'));
					} else {
						sip.send(sip.makeResponse(rq, 405, 'Method not allowed'));
					}
				}
			}
		}
	}
);
