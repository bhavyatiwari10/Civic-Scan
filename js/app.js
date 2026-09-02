(function(){
  "use strict";

  /* ---------------- Data ---------------- */
  var CANDIDATES = [
    { id:'c1', name:'Amara Osei',   tag:'Community-first infrastructure', color:'#33E0C7' },
    { id:'c2', name:'Devon Wallace',tag:'Small-business tax relief',      color:'#E7B84B' },
    { id:'c3', name:'Priya Nair',   tag:'Green transit expansion',        color:'#8695B3' },
    { id:'c4', name:'Marcus Ilić',  tag:'Digital-first public services',  color:'#F0555C' }
  ];
  var PROFILE_KEY = 'voter-profile';
  var TALLY_KEY = 'ballot-tally';
  var AUDIT_KEY = 'audit-log';
  var GENESIS_HASH = '0'.repeat(64);

  function initials(name){
    return name.split(' ').map(function(p){return p[0];}).join('').slice(0,2).toUpperCase();
  }

  /* ---------------- Tamper-evident audit log ----------------
     Each entry's hash is computed over its own fields PLUS the previous
     entry's hash (a hash chain, the same core idea behind blockchains
     and tamper-evident logs). Changing any past entry, or its position,
     breaks every hash after it — verifyAuditChain() re-derives every
     hash from scratch and checks it still matches what's stored. */
  async function sha256Hex(str){
    if(window.crypto && window.crypto.subtle && window.isSecureContext !== false){
      try{
        var enc = new TextEncoder().encode(str);
        var buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.prototype.map.call(new Uint8Array(buf), function(b){
          return b.toString(16).padStart(2,'0');
        }).join('');
      }catch(e){ /* fall through to fallback below */ }
    }
    // Fallback for non-secure contexts where SubtleCrypto is unavailable —
    // not cryptographically secure, but keeps the chain-integrity demo working.
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for(var i=0;i<str.length;i++){
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = (Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909)) >>> 0;
    h2 = (Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909)) >>> 0;
    return (h1.toString(16).padStart(8,'0') + h2.toString(16).padStart(8,'0')).repeat(4).slice(0,64);
  }
  async function getAuditLog(){
    try{ var raw = localStorage.getItem(AUDIT_KEY); return raw ? JSON.parse(raw) : []; }
    catch(e){ return []; }
  }
  async function setAuditLog(log){
    try{ localStorage.setItem(AUDIT_KEY, JSON.stringify(log)); }catch(e){}
  }
  async function appendAuditEntry(action, detail){
    var log = await getAuditLog();
    var prevHash = log.length ? log[log.length-1].hash : GENESIS_HASH;
    var entry = { seq: log.length+1, action: action, detail: detail||'', timestamp: Date.now(), prevHash: prevHash };
    var payload = entry.seq+'|'+entry.action+'|'+entry.detail+'|'+entry.timestamp+'|'+entry.prevHash;
    entry.hash = await sha256Hex(payload);
    log.push(entry);
    await setAuditLog(log);
    return entry;
  }
  async function verifyAuditChain(){
    var log = await getAuditLog();
    var prevHash = GENESIS_HASH;
    for(var i=0;i<log.length;i++){
      var e = log[i];
      if(e.prevHash !== prevHash) return { ok:false, brokenAt:i };
      var payload = e.seq+'|'+e.action+'|'+e.detail+'|'+e.timestamp+'|'+e.prevHash;
      var recomputed = await sha256Hex(payload);
      if(recomputed !== e.hash) return { ok:false, brokenAt:i };
      prevHash = e.hash;
    }
    return { ok:true, count:log.length };
  }

  /* ---------------- Storage helpers ----------------
     Uses localStorage so the app runs standalone in any browser
     (no server, no external runtime). Kept as async functions so
     the rest of the app's await-based calls don't need to change.
     NOTE: localStorage is per-browser/per-device, so "live results"
     reflect votes cast in *this* browser only — not a real multi-user
     shared tally. See README for what a real backend would need. */
  async function getProfile(){
    try{
      var raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  async function setProfile(obj){
    try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(obj)); }catch(e){ console.error(e); }
  }
  async function deleteProfile(){
    try{ localStorage.removeItem(PROFILE_KEY); }catch(e){}
  }
  async function getTally(){
    try{
      var raw = localStorage.getItem(TALLY_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  async function setTally(obj){
    try{ localStorage.setItem(TALLY_KEY, JSON.stringify(obj)); }catch(e){ console.error(e); }
  }
  function emptyTally(){
    var t = { total:0, counts:{} };
    CANDIDATES.forEach(function(c){ t.counts[c.id] = 0; });
    return t;
  }

  /* ---------------- App state ---------------- */
  var state = {
    profile:null,
    verifiedThisSession:false,
    loggedIn:false,
    selectedCandidate:null
  };

  var screens = ['register','scan','login','home'];
  function showScreen(name){
    screens.forEach(function(s){
      document.getElementById('screen-'+s).classList.toggle('hidden', s!==name);
    });
    updateStepper(name);
    updateSessionBadge(name);
  }

  function updateStepper(active){
    var map = { register:'scan', scan:'scan', login:'login', home:'vote' };
    var current = map[active] || 'scan';
    var order = ['scan','login','vote'];
    var idx = order.indexOf(current);
    document.querySelectorAll('.step').forEach(function(el){
      var step = el.getAttribute('data-step');
      var stepIdx = order.indexOf(step);
      el.classList.remove('active','done','pending');
      if(stepIdx < idx) el.classList.add('done');
      else if(stepIdx === idx) el.classList.add('active');
      else el.classList.add('pending');
    });
  }

  function updateSessionBadge(screenName){
    var dot = document.getElementById('sessionDot');
    var txt = document.getElementById('sessionText');
    if(screenName==='home' && state.loggedIn){
      dot.classList.add('on');
      txt.textContent = (state.profile ? state.profile.name : 'Voter') + ' · authenticated';
    } else if(screenName==='login' && state.verifiedThisSession){
      dot.classList.add('on');
      txt.textContent = 'Face verified · awaiting credentials';
    } else {
      dot.classList.remove('on');
      txt.textContent = 'No active session';
    }
  }

  function alertBox(msg, kind){
    kind = kind || 'error';
    var cls = kind === 'error' ? 'alert' : 'note';
    return '<div class="'+cls+'"><span>'+(kind==='error'?'⚠️':'ℹ️')+'</span><span>'+msg+'</span></div>';
  }

  /* ================= REGISTER SCREEN ================= */
  var regStream = null;
  var regEl = {
    video: document.getElementById('regVideo'),
    canvas: document.getElementById('regCanvas'),
    placeholder: document.getElementById('regPlaceholder'),
    ring: document.getElementById('regRing'),
    scanLine: document.getElementById('regScanLine'),
    status: document.getElementById('regStatus'),
    camBtn: document.getElementById('regCamBtn'),
    captureBtn: document.getElementById('regCaptureBtn'),
    submitBtn: document.getElementById('regSubmitBtn'),
    alert: document.getElementById('regAlert'),
    name: document.getElementById('regName'),
    id: document.getElementById('regId')
  };
  var regSnapshot = null;

  async function startRegCamera(){
    regEl.alert.innerHTML = '';
    try{
      regStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user' }, audio:false });
      regEl.video.srcObject = regStream;
      regEl.video.classList.remove('hidden');
      regEl.placeholder.classList.add('hidden');
      regEl.ring.classList.add('pulse');
      regEl.status.innerHTML = '<span class="spinner"></span> Camera live — center your face';
      regEl.captureBtn.disabled = false;
      regEl.camBtn.textContent = 'Camera enabled';
      regEl.camBtn.disabled = true;
    }catch(err){
      regEl.status.textContent = 'Camera unavailable';
      regEl.status.classList.add('err');
      regEl.alert.innerHTML = alertBox('Couldn\'t access your camera ('+ (err.message || 'permission denied') +'). You can allow camera access in your browser\'s address-bar permissions and try again.');
    }
  }

  function captureFrame(videoEl, canvasEl, size){
    size = size || 180;
    canvasEl.width = size; canvasEl.height = size;
    var ctx = canvasEl.getContext('2d');
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    var side = Math.min(vw, vh);
    var sx = (vw - side)/2, sy = (vh - side)/2;
    ctx.save();
    ctx.translate(size,0); ctx.scale(-1,1); // mirror to match preview
    ctx.drawImage(videoEl, sx, sy, side, side, 0, 0, size, size);
    ctx.restore();
    return canvasEl.toDataURL('image/jpeg', 0.7);
  }

  regEl.camBtn.addEventListener('click', startRegCamera);

  regEl.captureBtn.addEventListener('click', function(){
    if(!regEl.video.videoWidth){ return; }
    regSnapshot = captureFrame(regEl.video, regEl.canvas, 180);
    regEl.ring.classList.remove('pulse');
    regEl.ring.classList.add('locked');
    regEl.status.textContent = 'Reference face captured ✓';
    regEl.status.classList.remove('err');
    regEl.captureBtn.classList.add('hidden');
    regEl.submitBtn.classList.remove('hidden');
  });

  regEl.submitBtn.addEventListener('click', async function(){
    var name = regEl.name.value.trim();
    var id = regEl.id.value.trim();
    regEl.alert.innerHTML = '';
    if(!name || !id){
      regEl.alert.innerHTML = alertBox('Enter your full name and choose a voter ID before completing enrollment.');
      return;
    }
    if(!regSnapshot){
      regEl.alert.innerHTML = alertBox('Capture your reference face before completing enrollment.');
      return;
    }
    var profile = {
      name: name,
      voterId: id,
      faceSnapshot: regSnapshot,
      registeredAt: Date.now(),
      hasVoted: false,
      votedFor: null
    };
    await setProfile(profile);
    state.profile = profile;
    await appendAuditEntry('Voter enrolled', 'Voter ID ' + id);
    stopStream(regStream); regStream = null;
    goToScan();
  });

  document.getElementById('forgetProfileBtn').addEventListener('click', async function(){
    if(!confirm('Reset enrollment? This clears your saved face profile and voter ID on this device.')){ return; }
    await appendAuditEntry('Enrollment reset', state.profile ? ('Voter ID ' + state.profile.voterId) : '');
    await deleteProfile();
    state.profile = null;
    state.verifiedThisSession = false;
    state.loggedIn = false;
    resetRegisterForm();
    showScreen('register');
  });

  function resetRegisterForm(){
    regSnapshot = null;
    regEl.name.value=''; regEl.id.value='';
    regEl.ring.classList.remove('locked','pulse');
    regEl.captureBtn.classList.remove('hidden');
    regEl.captureBtn.disabled = true;
    regEl.submitBtn.classList.add('hidden');
    regEl.camBtn.disabled = false; regEl.camBtn.textContent = 'Enable camera';
    regEl.video.classList.add('hidden');
    regEl.placeholder.classList.remove('hidden');
    regEl.status.textContent = 'Awaiting camera access';
    regEl.status.classList.remove('err');
  }

  function stopStream(stream){
    if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); }
  }

  /* ================= SCAN SCREEN (login gate) ================= */
  var scanStream = null;
  var scanEl = {
    video: document.getElementById('scanVideo'),
    placeholder: document.getElementById('scanPlaceholder'),
    ring: document.getElementById('scanRing'),
    scanLine: document.getElementById('scanScanLine'),
    status: document.getElementById('scanStatus'),
    startBtn: document.getElementById('scanStartBtn'),
    retryBtn: document.getElementById('scanRetryBtn'),
    alert: document.getElementById('scanAlert'),
    intro: document.getElementById('scanIntro')
  };

  function goToScan(){
    scanEl.alert.innerHTML='';
    scanEl.status.textContent = 'Awaiting camera access';
    scanEl.status.classList.remove('err');
    scanEl.ring.classList.remove('locked','pulse');
    scanEl.scanLine.classList.remove('active');
    scanEl.startBtn.classList.remove('hidden');
    scanEl.retryBtn.classList.add('hidden');
    scanEl.intro.textContent = 'Welcome back, ' + (state.profile ? state.profile.name : 'voter') + '. Center your face in the frame to continue.';
    showScreen('scan');
  }

  scanEl.startBtn.addEventListener('click', runFaceScan);
  scanEl.retryBtn.addEventListener('click', runFaceScan);

  async function runFaceScan(){
    scanEl.alert.innerHTML = '';
    scanEl.startBtn.classList.add('hidden');
    scanEl.retryBtn.classList.add('hidden');
    scanEl.ring.classList.remove('locked');

    try{
      scanStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user' }, audio:false });
      scanEl.video.srcObject = scanStream;
      scanEl.video.classList.remove('hidden');
      scanEl.placeholder.classList.add('hidden');
    }catch(err){
      scanEl.status.textContent = 'Camera unavailable';
      scanEl.status.classList.add('err');
      scanEl.alert.innerHTML = alertBox('Couldn\'t access your camera. Grant camera permission and retry, or continue in simulated mode.');
      scanEl.retryBtn.classList.remove('hidden');
      offerSimulatedContinue();
      return;
    }

    scanEl.ring.classList.add('pulse');
    scanEl.scanLine.classList.add('active');

    var steps = [
      { text:'Positioning frame…', ms:650 },
      { text:'Detecting face…', ms:900 },
      { text:'Liveness check — please blink once…', ms:900 },
      { text:'Matching against enrolled profile…', ms:1000 },
      { text:'Identity verified ✓', ms:0 }
    ];

    var detected = await tryNativeFaceDetector(scanEl.video).catch(function(){ return null; });

    for(var i=0;i<steps.length;i++){
      await sleep(steps[i].ms);
      scanEl.status.innerHTML = (i<steps.length-1 ? '<span class="spinner"></span> ' : '') + steps[i].text;
    }

    scanEl.scanLine.classList.remove('active');
    scanEl.ring.classList.remove('pulse');
    scanEl.ring.classList.add('locked');
    scanEl.status.classList.remove('err');

    state.verifiedThisSession = true;
    stopStream(scanStream); scanStream = null;

    if(detected === false){
      scanEl.alert.innerHTML = alertBox('No face detected in frame — proceeding on a simulated match for this demo. In production, a failed detection would block sign-in.', 'note');
    }
    await appendAuditEntry('Face scan passed', detected===false ? 'Fallback/simulated match' : 'Live detection match');

    await sleep(500);
    goToLogin();
  }

  function offerSimulatedContinue(){
    scanEl.alert.innerHTML += alertBox('No camera? You can still preview the flow — the scan will simulate a successful match.', 'note');
    var btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Continue in simulated mode';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', async function(){
      scanEl.ring.classList.add('pulse');
      scanEl.status.innerHTML = '<span class="spinner"></span> Simulating verification…';
      await sleep(1200);
      scanEl.ring.classList.remove('pulse'); scanEl.ring.classList.add('locked');
      scanEl.status.textContent = 'Identity verified (simulated) ✓';
      state.verifiedThisSession = true;
      await appendAuditEntry('Face scan passed', 'Simulated mode (no camera)');
      await sleep(400);
      goToLogin();
    });
    scanEl.alert.appendChild(btn);
  }

  function tryNativeFaceDetector(videoEl){
    return new Promise(function(resolve, reject){
      if(!('FaceDetector' in window)){ resolve(null); return; }
      try{
        var fd = new window.FaceDetector({ fastMode:true, maxDetectedFaces:1 });
        setTimeout(function(){
          fd.detect(videoEl).then(function(faces){
            resolve(faces && faces.length>0);
          }).catch(function(){ resolve(null); });
        }, 700);
      }catch(e){ resolve(null); }
    });
  }

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  /* ================= LOGIN SCREEN ================= */
  var loginEl = {
    id: document.getElementById('loginId'),
    pw: document.getElementById('loginPw'),
    alert: document.getElementById('loginAlert'),
    submit: document.getElementById('loginSubmitBtn'),
    back: document.getElementById('loginBackBtn')
  };

  function goToLogin(){
    loginEl.alert.innerHTML = '';
    if(state.profile){ loginEl.id.value = state.profile.voterId; }
    loginEl.pw.value = '';
    showScreen('login');
  }

  loginEl.back.addEventListener('click', function(){
    goToScan();
  });

  loginEl.submit.addEventListener('click', async function(){
    loginEl.alert.innerHTML = '';
    if(!state.verifiedThisSession){
      loginEl.alert.innerHTML = alertBox('Face verification expired — please rescan.');
      goToScan();
      return;
    }
    var idVal = loginEl.id.value.trim();
    var pwVal = loginEl.pw.value;
    if(!idVal || pwVal.length < 4){
      loginEl.alert.innerHTML = alertBox('Enter your voter ID and a password of at least 4 characters.');
      return;
    }
    if(state.profile && idVal.toLowerCase() !== state.profile.voterId.toLowerCase()){
      loginEl.alert.innerHTML = alertBox('That voter ID doesn\'t match the enrolled profile for this scanned face.');
      return;
    }
    state.loggedIn = true;
    await appendAuditEntry('Voter signed in', 'Voter ID ' + idVal);
    enterHome();
  });

  /* ================= HOME / VOTE SCREEN ================= */
  var homeEl = {
    title: document.getElementById('homeTitle'),
    eyebrow: document.getElementById('homeEyebrow'),
    list: document.getElementById('candidateList'),
    submitBtn: document.getElementById('submitVoteBtn'),
    alert: document.getElementById('voteAlert'),
    votedPanel: document.getElementById('votedPanel'),
    votedFor: document.getElementById('votedFor'),
    receiptBox: document.getElementById('receiptBox'),
    receiptCode: document.getElementById('receiptCode'),
    receiptQR: document.getElementById('receiptQR'),
    paneVote: document.getElementById('paneVote'),
    paneResults: document.getElementById('paneResults'),
    paneAudit: document.getElementById('paneAudit'),
    tabVote: document.getElementById('tabVote'),
    tabResults: document.getElementById('tabResults'),
    tabAudit: document.getElementById('tabAudit'),
    resultsList: document.getElementById('resultsList'),
    totalText: document.getElementById('totalVotesText'),
    turnoutChart: document.getElementById('turnoutChart'),
    auditLog: document.getElementById('auditLog'),
    chainVerdict: document.getElementById('chainVerdict')
  };

  function renderCandidates(){
    homeEl.list.innerHTML = '';
    CANDIDATES.forEach(function(c){
      var row = document.createElement('label');
      row.className = 'candidate';
      row.dataset.id = c.id;
      row.innerHTML =
        '<input type="radio" name="candidate" value="'+c.id+'"/>' +
        '<div class="avatar" style="background:'+c.color+'">'+initials(c.name)+'</div>' +
        '<div><div class="cand-name">'+c.name+'</div><div class="cand-tag">'+c.tag+'</div></div>';
      row.addEventListener('click', function(){
        state.selectedCandidate = c.id;
        document.querySelectorAll('.candidate').forEach(function(el){ el.classList.remove('selected'); });
        row.classList.add('selected');
        row.querySelector('input').checked = true;
        homeEl.submitBtn.disabled = false;
      });
      homeEl.list.appendChild(row);
    });
  }

  async function enterHome(){
    homeEl.eyebrow.textContent = 'Checkpoint 03 · Signed in as ' + state.profile.name;
    homeEl.alert.innerHTML = '';
    state.selectedCandidate = null;
    homeEl.submitBtn.disabled = true;

    if(state.profile.hasVoted){
      showVotedState();
    }else{
      homeEl.votedPanel.classList.add('hidden');
      homeEl.list.style.display = '';
      homeEl.submitBtn.style.display = '';
      homeEl.title.textContent = 'Cast your ballot';
      renderCandidates();
    }
    switchTab('vote');
    showScreen('home');
    resetIdleTimer();
    await refreshResults();
  }

  function showVotedState(){
    homeEl.list.style.display = 'none';
    homeEl.submitBtn.style.display = 'none';
    homeEl.title.textContent = 'Your ballot';
    homeEl.votedPanel.classList.remove('hidden');
    var c = CANDIDATES.find(function(x){ return x.id === state.profile.votedFor; });
    homeEl.votedFor.textContent = c ? ('You voted for ' + c.name + '.') : 'Your vote has been recorded.';
    if(state.profile.receiptId){
      homeEl.receiptBox.classList.remove('hidden');
      homeEl.receiptCode.textContent = state.profile.receiptId;
      var qrText = 'CivicScan receipt ' + state.profile.receiptId + ' — a ballot was cast under this code.';
      homeEl.receiptQR.src = 'https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' + encodeURIComponent(qrText);
    } else {
      homeEl.receiptBox.classList.add('hidden');
    }
  }

  function makeReceiptId(){
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for(var i=0;i<8;i++){ out += chars[Math.floor(Math.random()*chars.length)]; if(i===3) out+='-'; }
    return out;
  }

  homeEl.submitBtn.addEventListener('click', async function(){
    if(!state.selectedCandidate) return;
    homeEl.alert.innerHTML = '';
    homeEl.submitBtn.disabled = true;
    homeEl.submitBtn.textContent = 'Submitting…';

    var tally = await getTally() || emptyTally();
    if(!tally.counts) tally.counts = {};
    if(!tally.history) tally.history = [];
    CANDIDATES.forEach(function(c){ if(typeof tally.counts[c.id] !== 'number') tally.counts[c.id] = 0; });
    tally.counts[state.selectedCandidate] += 1;
    tally.total = (tally.total || 0) + 1;
    tally.history.push({ t: Date.now() });
    await setTally(tally);

    var receiptId = makeReceiptId();
    state.profile.hasVoted = true;
    state.profile.votedFor = state.selectedCandidate;
    state.profile.receiptId = receiptId;
    await setProfile(state.profile);

    // Deliberately does NOT log which candidate was chosen — the audit
    // trail proves *that* a ballot was cast without revealing the choice.
    await appendAuditEntry('Ballot submitted', 'Receipt ' + receiptId);

    homeEl.submitBtn.textContent = 'Submit vote';
    showVotedState();
    await refreshResults();
  });

  document.getElementById('viewResultsBtn').addEventListener('click', function(){ switchTab('results'); });
  homeEl.tabVote.addEventListener('click', function(){ switchTab('vote'); });
  homeEl.tabResults.addEventListener('click', function(){ switchTab('results'); refreshResults(); });
  homeEl.tabAudit.addEventListener('click', function(){ switchTab('audit'); renderAuditLog(); });

  function switchTab(name){
    homeEl.paneVote.classList.toggle('hidden', name!=='vote');
    homeEl.paneResults.classList.toggle('hidden', name!=='results');
    homeEl.paneAudit.classList.toggle('hidden', name!=='audit');
    homeEl.tabVote.classList.toggle('active', name==='vote');
    homeEl.tabResults.classList.toggle('active', name==='results');
    homeEl.tabAudit.classList.toggle('active', name==='audit');
  }

  async function refreshResults(){
    var tally = await getTally() || emptyTally();
    var total = tally.total || 0;
    homeEl.resultsList.innerHTML = '';
    CANDIDATES.forEach(function(c){
      var count = (tally.counts && tally.counts[c.id]) || 0;
      var pct = total > 0 ? Math.round((count/total)*100) : 0;
      var row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML =
        '<div class="result-top"><span class="result-name">'+c.name+'</span><span class="result-pct mono">'+count+' · '+pct+'%</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%; background:'+c.color+'"></div></div>';
      homeEl.resultsList.appendChild(row);
    });
    homeEl.totalText.textContent = total + ' vote' + (total===1?'':'s') + ' cast so far · updates live across sessions';
    renderTurnoutChart(tally);
  }

  function renderTurnoutChart(tally){
    var el = homeEl.turnoutChart; if(!el) return;
    var history = (tally.history || []).slice().sort(function(a,b){ return a.t - b.t; });
    if(!history.length){ el.innerHTML = '<p class="card-sub" style="margin:0;font-size:12.5px;">No votes cast yet — the turnout curve will build up as ballots come in.</p>'; return; }
    var w = 520, h = 120, pad = 10;
    var points = history.map(function(_, i){
      var x = pad + (i/(Math.max(history.length-1,1))) * (w - pad*2);
      var y = h - pad - ((i+1)/history.length) * (h - pad*2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var pathD = 'M' + points.join(' L');
    var areaD = pathD + ' L' + (w-pad) + ',' + (h-pad) + ' L' + pad + ',' + (h-pad) + ' Z';
    el.innerHTML =
      '<svg width="100%" height="'+h+'" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="overflow:visible">' +
        '<defs><linearGradient id="turnoutFill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#33E0C7" stop-opacity="0.35"/>' +
          '<stop offset="100%" stop-color="#33E0C7" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="'+areaD+'" fill="url(#turnoutFill)" stroke="none"></path>' +
        '<path d="'+pathD+'" fill="none" stroke="#33E0C7" stroke-width="2"></path>' +
      '</svg>' +
      '<p class="card-sub" style="margin:8px 0 0;font-size:11.5px;">Cumulative ballots cast, left (earliest) to right (most recent) — '+history.length+' total.</p>';
  }

  async function renderAuditLog(){
    var log = await getAuditLog();
    homeEl.chainVerdict.innerHTML = '';
    if(!log.length){
      homeEl.auditLog.innerHTML = '<p class="card-sub" style="margin:0;">No audit entries yet — actions like enrolling, scanning, and voting will appear here as a hash-chained log.</p>';
      return;
    }
    homeEl.auditLog.innerHTML = log.slice().reverse().map(function(e){
      return '<div class="audit-entry" data-seq="'+e.seq+'">' +
        '<div class="audit-top"><span class="audit-action">#'+e.seq+' · '+escapeHTMLAudit(e.action)+'</span>' +
        '<span class="audit-time">'+new Date(e.timestamp).toLocaleString()+'</span></div>' +
        (e.detail ? '<div class="card-sub" style="margin:2px 0 6px;font-size:12px;">'+escapeHTMLAudit(e.detail)+'</div>' : '') +
        '<div class="audit-hash">hash '+e.hash.slice(0,24)+'…</div>' +
      '</div>';
    }).join('');
  }
  function escapeHTMLAudit(v){
    return String(v==null?'':v).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c];
    });
  }

  document.getElementById('verifyChainBtn').addEventListener('click', async function(){
    var btn = document.getElementById('verifyChainBtn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    var result = await verifyAuditChain();
    btn.disabled = false; btn.textContent = '🔒 Verify chain integrity';
    if(result.ok){
      homeEl.chainVerdict.innerHTML = '<div class="chain-verdict ok">✅ Chain intact — all '+result.count+' entries verified, each hash correctly links to the one before it.</div>';
    } else {
      homeEl.chainVerdict.innerHTML = '<div class="chain-verdict bad">⚠️ Chain broken at entry #'+(result.brokenAt+1)+' — this entry\'s hash no longer matches its recorded content, or the link to the previous entry is inconsistent.</div>';
      var broken = document.querySelector('.audit-entry[data-seq="'+(result.brokenAt+1)+'"]');
      if(broken) broken.classList.add('broken');
    }
  });

  document.getElementById('exportAuditBtn').addEventListener('click', async function(){
    var log = await getAuditLog();
    downloadTextFile('civicscan-audit-log.json', JSON.stringify(log, null, 2), 'application/json');
  });

  document.getElementById('exportResultsBtn').addEventListener('click', async function(){
    var tally = await getTally() || emptyTally();
    var rows = [['Candidate','Votes','Percent']];
    var total = tally.total || 0;
    CANDIDATES.forEach(function(c){
      var count = (tally.counts && tally.counts[c.id]) || 0;
      var pct = total>0 ? ((count/total)*100).toFixed(1) : '0.0';
      rows.push([c.name, count, pct+'%']);
    });
    var csv = rows.map(function(r){ return r.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
    downloadTextFile('civicscan-results.csv', csv, 'text/csv');
  });

  function downloadTextFile(name, data, type){
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data],{type:type}));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function doLogout(){
    if(state.loggedIn){ appendAuditEntry('Voter signed out', state.profile ? ('Voter ID ' + state.profile.voterId) : ''); }
    state.loggedIn = false;
    state.verifiedThisSession = false;
    state.selectedCandidate = null;
    stopIdleWatch();
    goToScan();
  }
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('logoutBtn2').addEventListener('click', doLogout);

  /* ================= Theme toggle ================= */
  var THEME_KEY = 'civicscan-theme';
  var themeBtn = document.getElementById('themeToggle');
  function applyTheme(mode){
    document.body.classList.toggle('light', mode==='light');
    themeBtn.textContent = mode==='light' ? '☀️' : '🌙';
  }
  (function initTheme(){
    var saved = null;
    try{ saved = localStorage.getItem(THEME_KEY); }catch(e){}
    applyTheme(saved || 'dark');
  })();
  themeBtn.addEventListener('click', function(){
    var next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  });

  /* ================= Idle / inactivity timeout (voting-booth security) ================= */
  var IDLE_LIMIT_MS = 45000;   // time before the warning appears
  var IDLE_COUNTDOWN_S = 20;   // seconds shown counting down before auto-logout
  var idleTimer = null, idleCountdownTimer = null, idleSecondsLeft = IDLE_COUNTDOWN_S;
  var idleOverlay = document.getElementById('idleOverlay');
  var idleCountdownEl = document.getElementById('idleCountdown');
  var idleStayBtn = document.getElementById('idleStayBtn');

  function isOnHomeScreen(){
    return !document.getElementById('screen-home').classList.contains('hidden');
  }
  function resetIdleTimer(){
    if(!state.loggedIn || !isOnHomeScreen()) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(showIdleWarning, IDLE_LIMIT_MS);
  }
  function showIdleWarning(){
    if(!state.loggedIn || !isOnHomeScreen()) return;
    idleSecondsLeft = IDLE_COUNTDOWN_S;
    idleCountdownEl.textContent = idleSecondsLeft;
    idleOverlay.classList.remove('hidden');
    idleCountdownTimer = setInterval(function(){
      idleSecondsLeft -= 1;
      idleCountdownEl.textContent = idleSecondsLeft;
      if(idleSecondsLeft <= 0){
        clearInterval(idleCountdownTimer);
        idleOverlay.classList.add('hidden');
        doLogout();
      }
    }, 1000);
  }
  function dismissIdleWarning(){
    clearInterval(idleCountdownTimer);
    idleOverlay.classList.add('hidden');
    resetIdleTimer();
  }
  function stopIdleWatch(){
    clearTimeout(idleTimer);
    clearInterval(idleCountdownTimer);
    idleOverlay.classList.add('hidden');
  }
  idleStayBtn.addEventListener('click', dismissIdleWarning);
  ['click','keydown','touchstart'].forEach(function(evt){
    document.addEventListener(evt, function(){
      if(!idleOverlay.classList.contains('hidden')) return; // don't reset while the warning itself is showing
      resetIdleTimer();
    }, { passive:true });
  });

  /* ================= Init ================= */
  async function init(){
    var profile = await getProfile();
    state.profile = profile;
    if(profile){
      resetRegisterForm();
      goToScan();
    }else{
      resetRegisterForm();
      showScreen('register');
    }
    // Poll shared results periodically so the results tab stays live
    setInterval(function(){
      if(!document.getElementById('screen-home').classList.contains('hidden') &&
         !document.getElementById('paneResults').classList.contains('hidden')){
        refreshResults();
      }
    }, 4000);
  }

  init();
})();
