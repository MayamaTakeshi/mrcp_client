# mrcp_client

This is an experimental Media Resource Control Protocol (MRCPv2) client that I'm writing in node.js for learning purposes.

You must have sox installed. Do:

```
  apt install sox
```
or
```
  yum install sox
```

Then create config file:
```
  cp config/default.js.sample config/default.js
  vim config/default.js # ajdust parameters as necessary (minimally, set the local_ip)
```

Then you can use either:
```
  node speechsynth_client.js
```
or
```
  node speechrecog_client.js
```

to send requests to an MRCPv2 server (you can try it with https://github.com/MayamaTakeshi/mrcp_server)

