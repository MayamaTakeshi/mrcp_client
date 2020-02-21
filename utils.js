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
a=${resource_type == 'synth' ? 'recvonly' : 'sendonly'}
a=mid:1`
}


module.exports = {
	rstring,
	gen_sdp,
}
