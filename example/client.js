var pc = null;
var dc = null, dcInterval = null;
var object_id;

document.getElementById("stop").setAttribute("disabled", true);
function createPeerConnection() {
    var config = {
        sdpSemantics: 'unified-plan',
	iceServers: [{urls: ['stun:stun.l.google.com:19302']}]
    };
    pc = new RTCPeerConnection(config);

    pc.addEventListener('track', function(evt) {
        document.getElementById('video').srcObject = evt.streams[0];
    });

    return pc;
}

let count = 0;
var config = {
    type: 'line',
    data: {
        labels: [],
        datasets: [
        ]},
      options: {
        responsive: true,
	maintainAspectRatio: false,
        title: {
            display: false,
            text: 'Creating Real-Time Charts with Flask'
          },
          tooltips: {
            mode: 'index',
            intersect: false,
          },
          hover: {
            mode: 'nearest',
            intersect: true
          },
          scales: {
            xAxes: [{
                display: true,
                scaleLabel: {
                    display: true,
                  }
              }],
            yAxes: [{
                display: true,
                scaleLabel: {
                    display: true,
                  }
              }]
          }
      }
  };

const context = document.getElementById('canvas').getContext('2d');
const lineChart = new Chart(context, config);

var dataUpdate = function() {
  fetch('/num')
  .then(function(response) {
    return response.json();
  })
  .then(function(data) {
    if (config.data.labels.length === 6) {
      config.data.labels.shift();
      for(i = 0; i < 7; i ++) {
        config.data.datasets[i].data.shift();
      }
    }
    if(object_id == data.object_id) {
      if (count == 0 || count == 1 || count % 15 == 0) {
        config.data.labels.push(data.time);
        lineChart.update();
      }
    }
    count = count+1
    dataUpdateId = setTimeout(dataUpdate, 150);
  });
}


function negotiate() {
    return pc.createOffer().then(function(offer) {
        return pc.setLocalDescription(offer);
    }).then(function() {
        return new Promise(function(resolve) {
            if (pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                function checkState() {
                    if (pc.iceGatheringState === 'complete') {
                        pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                }
                pc.addEventListener('icegatheringstatechange', checkState);
            }
        });
    }).then(function() {
        var offer = pc.localDescription;
        var codec;

        codec = "default";

        return fetch('/offer', {
            body: JSON.stringify({
                sdp: offer.sdp,
                type: offer.type,
                video_transform: "none"
            }),
            headers: {
                'Content-Type': 'application/json'
            },
            method: 'POST'
        });
    }).then(function(response) {
        return response.json();
    }).then(function(answer) {
	document.getElementById("stop").removeAttribute("disabled");
	document.getElementById("start").setAttribute("disabled", true);
	object_id = answer.object_id
	dataUpdate();
	return pc.setRemoteDescription(answer);
    }).catch(function(e) {
        alert(e);
    });
}

function start() {
    document.getElementById('media').style.display = 'block';
    pc = createPeerConnection();

    var time_start = null;

    function current_stamp() {
        if (time_start === null) {
            time_start = new Date().getTime();
            return 0;
        } else {
            return new Date().getTime() - time_start;
        }
    }

    var constraints = {
        video: false
    };

    var resolution = "480x360"
    if (resolution) {
          resolution = resolution.split('x');
          constraints.video = {
              width: parseInt(resolution[0], 0),
              height: parseInt(resolution[1], 0)
      	  };
    } else {
          constraints.video = true;
    }

    if (constraints.video) {
        document.getElementById('media').style.display = 'block';

        navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
            stream.getTracks().forEach(function(track) {
                pc.addTrack(track, stream);
            });
            return negotiate();
        }, function(err) {
            alert('Could not acquire media: ' + err);
        });
    } else {
        negotiate();
    }
}

function stop() {
    document.getElementById('media').style.display = 'none';
    clearTimeout(dataUpdateId);
    document.getElementById("start").removeAttribute("disabled");
    document.getElementById("stop").setAttribute("disabled", true);

    if (dc) {
        dc.close();
    }

    if (pc.getTransceivers) {
        pc.getTransceivers().forEach(function(transceiver) {
            if (transceiver.stop) {
                transceiver.stop();
            }
        });
    }

    pc.getSenders().forEach(function(sender) {
        sender.track.stop();
    });

    setTimeout(function() {
        pc.close();
    }, 500);
}

function sdpFilterCodec(kind, codec, realSdp) {
    var allowed = []
    var rtxRegex = new RegExp('a=fmtp:(\\d+) apt=(\\d+)\r$');
    var codecRegex = new RegExp('a=rtpmap:([0-9]+) ' + escapeRegExp(codec))
    var videoRegex = new RegExp('(m=' + kind + ' .*?)( ([0-9]+))*\\s*$')

    var lines = realSdp.split('\n');

    var isKind = false;
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=' + kind + ' ')) {
            isKind = true;
        } else if (lines[i].startsWith('m=')) {
            isKind = false;
        }

        if (isKind) {
            var match = lines[i].match(codecRegex);
            if (match) {
                allowed.push(parseInt(match[1]));
            }

            match = lines[i].match(rtxRegex);
            if (match && allowed.includes(parseInt(match[2]))) {
                allowed.push(parseInt(match[1]));
            }
        }
    }

    var skipRegex = 'a=(fmtp|rtcp-fb|rtpmap):([0-9]+)';
    var sdp = '';

    isKind = false;
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=' + kind + ' ')) {
            isKind = true;
        } else if (lines[i].startsWith('m=')) {
            isKind = false;
        }

        if (isKind) {
            var skipMatch = lines[i].match(skipRegex);
            if (skipMatch && !allowed.includes(parseInt(skipMatch[2]))) {
                continue;
            } else if (lines[i].match(videoRegex)) {
                sdp += lines[i].replace(videoRegex, '$1 ' + allowed.join(' ')) + '\n';
            } else {
                sdp += lines[i] + '\n';
            }
        } else {
            sdp += lines[i] + '\n';
        }
    }

    return sdp;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
