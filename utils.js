const assert = require('assert')
const dgram = require('dgram')
const mrcp = require('mrcp')
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

    var rtp_ports
    if(local_rtp_port) {
        rtp_ports = [local_rtp_port]
    } else {
        rtp_ports = _.shuffle(_.range(10000, 65535, 2))
    }

    var p = alloc_free_port(rtp_ports, local_ip)

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
	build_mrcp_request,
}

