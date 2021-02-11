const assert = require('assert')
const dgram = require('dgram')
const mrcp = require('mrcp')
const dm = require('data-matching')
const _ = require('lodash')
const RtpSession = require('rtp-session')
const deasyncPromise = require('deasync-promise')


const alloc_free_port = async (port_numbers, addr) => {
    var alloc_udp_port = (port, addr) => {
        return new Promise((resolve, reject) => {
            const server = dgram.createSocket('udp4');

            server.once('error', (err) => {
                if(err.code == 'EADDRINUSE') {
                    server.close();
                    reject(err);
                }
            });

            server.once('listening', () => {
                resolve(server)
            });

            server.bind(port, addr)
        })
    }

    return new Promise(async (resolve, reject) => {
        var socket = null
        for (let i = 0; i < port_numbers.length; i++) {
            var port_number = port_numbers[i]
            console.log(port_number)
            // wait for the promise to resolve before advancing the for loop
            try {
                var socket = await alloc_udp_port(port_number, addr);
                break
            } catch(err) {
                    console.error(`error: ${err}`)
            }
        }
        resolve(socket) 
    })
}


const alloc_rtp_session = (local_rtp_port, local_ip) => {
    const rtp_session = new RtpSession({})

    var rtp_port_range
    if(local_rtp_port) {
        rtp_port_range = [local_rtp_port]
    } else {
        rtp_port_range = _.range(10000, 65535, 2)
    }

    var p = alloc_free_port(rtp_port_range, local_ip)

    socket = deasyncPromise(p)
    if(!socket) {
        return null
    }

    rtp_session.set_socket(socket)
    return rtp_session
}


const find_free_sip_port = (local_sip_port, local_ip) => {
    var sip_port_range
    if(local_sip_port) {
        sip_port_range = [local_sip_port]
    } else {
        sip_port_range = _.range(5060, 65535)
    }

    var p = alloc_free_port(_.range(5060, 65535), local_ip)

    var socket = deasyncPromise(p)
    if(!socket) {
        return null
    }

    var address = socket.address()
    socket.close() // will be reused by sip stack

    return address.port
}


const rstring = () => {
    return Math.floor(Math.random()*1e6).toString()
}


const gen_sdp = (resource_type, local_rtp_ip, local_rtp_port) => {
	return `v=0
o=mrcp_client 5772550679930491611 4608916746797952899 IN IP4 ${local_rtp_ip}
s=-
c=IN IP4 ${local_rtp_ip}
t=0 0
m=application 9 TCP/MRCPv2 1
a=setup:active
a=connection:new
a=resource:${resource_type}
a=cmid:1
m=audio ${local_rtp_port} RTP/AVP 0
a=rtpmap:0 PCMU/8000
a=${resource_type == 'speechsynth' ? 'recvonly' : 'sendonly'}
a=mid:1`.replace(/\n/g, "\r\n")
}


const parse_sdp = (s) => {
	var sdp = {
		media: []
	}
	var lines = s.split("\r\n")
	var media_id = -1
	lines.forEach(line => {
		var key = line.slice(0,1)
		var val = line.slice(2)

		switch(key) {
		case 'c':
			var c = val.split(" ")
			assert(c.length == 3)			
			sdp.connection = {
				ip: c[2]
			}
			break
		case 'm':
			var m = val.split(" ")
			assert(m.length >= 4)
			media_id++
			sdp.media[media_id] = {
				type: m[0],
				port: parseInt(m[1]),
				protocol: m[2],
				payloads: m.slice(3),
			}
			break
		case 'a':
			var a = val.split(":")
			var k = a[0]
			var v = a[1]
			switch (k) {
			case 'resource':
				sdp.media[media_id].resource = v
				break
			case 'setup':
				sdp.media[media_id].setup = v
				break
			case 'connection':
				sdp.media[media_id].connection = v
				break
			case 'direction':
				sdp.media[media_id].direction = v
				break
			case 'channel':
				sdp.media[media_id].channel = v
				break
			}
		}
	})
	return sdp
}


const sdp_matcher = dm.partial_match({
	connection: { ip: dm.collect('remote_ip') },
	media: dm.unordered_list([
		{
			type: 'application',
			port: dm.collect('remote_mrcp_port'),
			protocol: 'TCP/MRCPv2',
			payloads: ["1"],
			channel: dm.collect('channel'),
		},
		{
			type: 'audio',
			port: dm.collect('remote_rtp_port'),
			protocol: 'RTP/AVP',
			payloads: dm.collect("rtp_payloads"),
		}
	])
})


const build_mrcp_request = (message, request_id, channel_identifier, args) => {
	var headers = {
		'channel-identifier': channel_identifier,
	}

	var msg
	if(message == 'SPEAK') {
		headers['content-type'] = args.text.indexOf('<speak>') >= 0 ? 'application/ssml+xml' : 'text/plain'
		headers['speech-language'] = args.language
		headers['voice-name'] = args.voice
		msg = mrcp.builder.build_request(message, request_id, headers, args.text)
	} else if(message == 'DEFINE-GRAMMAR') {
		headers['content-id'] = args.content_id
		headers['content-type'] = 'application/xml'
		msg = mrcp.builder.build_request(message, request_id, headers, args.grammar)
	} else if(message == 'RECOGNIZE') {
		headers['content-type'] = 'text/uri-list'
		headers['speech-language'] = args.language
		msg = mrcp.builder.build_request(message, request_id, headers, "session:" + args.content_id)
	} else if(message == 'STOP') {
		msg = mrcp.builder.build_request(message, request_id, headers, null)
	} else {
		console.error("IMPLEMENTATION PENDING")
		process.exit(1)
	}

	return msg
}


module.exports = {
    alloc_free_port,
    alloc_rtp_session,
    find_free_sip_port,
	rstring,
	gen_sdp,
	parse_sdp,
	sdp_matcher,
	build_mrcp_request,
}

