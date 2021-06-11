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


// Original C code for linear2ulaw by:
//** Craig Reese: IDA/Supercomputing Research Center
//** Joe Campbell: Department of Defense
//** 29 September 1989
// http://www.speech.cs.cmu.edu/comp.speech/Section2/Q2.7.html

const exp_lut = [0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
				 4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
				 5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
				 5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
				 6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
				 6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
				 6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
				 6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
				 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]

const BIAS = 0x84   /* define the add-in bias for 16 bit samples */
const CLIP = 32635

const linear2ulaw = (sample) => {
	var sign, exponent, mantissa
	var ulawbyte

	/* Get the sample into sign-magnitude. */
	sign = (sample >> 8) & 0x80;		/* set aside the sign */
	if (sign != 0) sample = -sample;		/* get magnitude */
	if (sample > CLIP) sample = CLIP;		/* clip the magnitude */

	/* Convert from 16 bit linear to ulaw. */
	sample = sample + BIAS;
	exponent = exp_lut[(sample >> 7) & 0xFF];
	mantissa = (sample >> (exponent + 3)) & 0x0F;
	ulawbyte = ~(sign | (exponent << 4) | mantissa);

/*
//#ifdef ZEROTRAP
*/
	if (ulawbyte == 0) ulawbyte = 0x02;	// optional CCITT trap
/*
//#endif
*/

	return ulawbyte
}


const ulaw2linear = (ulawbyte) => {
  var exp_lut = [0,132,396,924,1980,4092,8316,16764]
  var sign, exponent, mantissa, sample

  ulawbyte = ~ulawbyte
  sign = (ulawbyte & 0x80)
  exponent = (ulawbyte >> 4) & 0x07
  mantissa = ulawbyte & 0x0F
  sample = exp_lut[exponent] + (mantissa << (exponent + 3))
  if (sign != 0) sample = -sample

  return(sample)
}


module.exports = {
    alloc_free_port,
    alloc_rtp_session,
    find_free_sip_port,
	rstring,
    linear2ulaw,
    ulaw2linear,
}

