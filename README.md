# mrcp_client

This is an experimental Media Resource Control Protocol (MRCPv2) client that I'm writing in node.js for learning purposes.

The version of node used for development can found in the package.json file.

## Installation

First install non-npm dependencies. Do:

```
  apt install sox libasound2-dev
```
or
```
  yum install sox libasound2-devel
```

and then istall npm dependencies
```
  npm install
```

Then create config file:
```
  cp config/default.js.sample config/default.js
  vim config/default.js # ajdust parameters as necessary (minimally, set the local_ip)
```

## Testing

You can test by using either:
```
  node speechsynth_client.js
```
or
```
  node speechrecog_client.js
```

You can try them with https://github.com/MayamaTakeshi/mrcp_server

Once it is installed you can test Google Speech Synthesis like this:
```
  node speechsynth_client.js 127.0.0.1 8070 en-US en-US-Wavenet-E "Hello World."

  node speechsynth_client.js 127.0.0.1 8070 ja-JP ja-JP-Wavenet-A "おはようございます."
```
or like this to save audio to a wav file:
```
  node speechsynth_client.js -w generated_speech.wav 127.0.0.1 8070 en-US en-US-Wavenet-E "Hello World."
```

To test Google Speech Recognition:
```
  node speechrecog_client.js 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav artifacts/grammar.xml
```

If you use mrcp_server and don't have Google credentials, you can test using DTMF:
```
  node speechsynth_client.js 127.0.0.1 8070 dtmf dtmf 1234567890abcd*#

  node speechrecog_client.js 127.0.0.1 8070 dtmf artifacts/dtmf.0123456789ABCDEF.16000hz.wav artifacts/grammar.xml
```

