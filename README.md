# mrcp_client

This is an experimental Media Resource Control Protocol (MRCPv2) client that I'm writing in node.js for learning purposes.

The version of node used for development can be found in the package.json file.

## Installation

First install non-npm dependencies. Do:

```
apt install sox libasound2-dev
```
or
```
yum install sox libasound2-devel
```

and then install npm dependencies
```
npm install
```

Then create config file:
```
cp config/default.js.sample config/default.js
vim config/default.js # adjust parameters as necessary (minimally, set the local_ip)
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
or like this to use SSML:
```
node speechsynth_client.js 127.0.0.1 8070 en-US en-US-Standard-C "<speak><prosody rate='x-slow' pitch='3st'>I'm sad today.</prosody></speak>"
```

To test Google Speech Recognition:
```
node speechrecog_client.js 127.0.0.1 8070 ja-JP artifacts/ohayou_gozaimasu.wav artifacts/grammar.xml
```

If you use mrcp_server and don't have Google credentials, you can test using DTMF:
```
node speechsynth_client.js 127.0.0.1 8070 dtmf dtmf 1234567890abcd*#

node speechrecog_client.js 127.0.0.1 8070 dtmf artifacts/dtmf.0123456789ABCDEF.16000hz.wav artifacts/grammar_empty.xml
```

## Load testing

While this tool was not developed with load testing in mind, if you need to make several calls to your MRCP server you can do it with something like this for speechsynth:
```
NUMBER_OF_CALLS=10; for i in $(seq 1 $NUMBER_OF_CALLS);do node speechsynth_client.js 127.0.0.1 8070 dtmf dtmf 1234 & sleep 0.1; done
```
or this for speechrecog:
```
NUMBER_OF_CALLS=10; for i in $(seq 1 $NUMBER_OF_CALLS);do node speechrecog_client.js 127.0.0.1 8070 dtmf artifacts/dtmf.0123456789ABCDEF.16000hz.wav artifacts/grammar_empty.xml & sleep 0.1; done
```

  Obs: the "sleep 0.1" is necessary to minimize the risk of failing to allocate the UDP port for the SIP stack due to a shortcoming in the sip.js library we are using. Ref: https://github.com/kirm/sip.js/issues/147

And to keep generating calls in a loop you can use something like this for speechsynth:
```
NUMBER_OF_CALLS=10; while [[ 1 ]];do for i in $(seq 1 $NUMBER_OF_CALLS);do node speechsynth_client.js -t 5000 127.0.0.1 8070 dtmf dtmf 1234 & sleep 0.1; done; sleep 2; done
```
or this for speechrecog:
```
NUMBER_OF_CALLS=10; while [[ 1 ]];do for i in $(seq 1 $NUMBER_OF_CALLS);do node speechrecog_client.js -t 5000 127.0.0.1 8070 dtmf artifacts/dtmf.0123456789ABCDEF.16000hz.wav artifacts/grammar_empty.xml & sleep 0.1; done; sleep 4; done
```

Obs: be careful when load testing an MRCP server that uses paid speech services like Google Speech, Amazon Polly etc as you might get a large bill if you forget the load test running for very long.


