const assert = require('assert')
const dgram = require('dgram')

const mrcp = require('mrcp')

const dm = require('data-matching')

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
		headers['content-type'] = 'text/plain'
		headers['speech-language'] = args.language
		headers['voice-name'] = args.voice
		msg = mrcp.builder.build_request(message, request_id, headers, args.text)
	} else {
		console.error("IMPLEMENTATION PENDING")
		process.exit(1)
	}

	return msg
}


module.exports = {
	rstring,
	gen_sdp,
	parse_sdp,
	sdp_matcher,
	build_mrcp_request,
}

