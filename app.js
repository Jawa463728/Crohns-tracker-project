import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  addDoc, getDocs, query, orderBy, limit, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
enableIndexedDbPersistence(db).catch(() => {});

const $ = (id) => document.getElementById(id);
const authView = $("authView"), appView = $("appView");
let user = null, todayLog = {}, settings = {};
let chartScore, chartStressSleep, chartBowel;
let selectedRange = 7;

const localDateKey = (d = new Date()) => {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const todayKey = () => localDateKey();
const nowTime = () => new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
const niceDate = (key) => new Date(key+"T12:00:00").toLocaleDateString([], {weekday:"short", day:"numeric", month:"short"});
const clamp = (n,min,max) => Math.max(min, Math.min(max,n));
const daysFromStock = (n) => Math.max(0, Number(n || 0));

function toast(message){
  const el=$("toast"); el.textContent=message; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),1800);
}

const questions = [
  {key:"wellbeing", title:"How are you feeling?", prompt:"Your overall sense of wellbeing today.", options:[
    ["1","😣","Very rough"],["2","🙁","Rough"],["3","😐","Okay"],["4","🙂","Good"],["5","😄","Great"]
  ]},
  {key:"stomach", title:"How is your stomach?", prompt:"Think about comfort, cramping and general gut symptoms.", options:[
    ["1","","Bad"],["2","","Rough"],["3","","Okay"],["4","","Good"],["5","","Great"]
  ]},
  {key:"fatigue", title:"How is your energy?", prompt:"How tired or alert have you felt?", options:[
    ["1","🥱","Exhausted"],["2","😴","Tired"],["3","","Okay"],["4","⚡","Alert"],["5","✨","Energised"]
  ]},
  {key:"pain", title:"Any abdominal pain?", prompt:"0 means none; 10 means severe.", type:"scale", min:0, max:10},
  {key:"bowelCount", title:"How many bowel movements?", prompt:"Your total so far today.", type:"scale", min:0, max:10},
  {key:"consistency", title:"Typical consistency?", prompt:"Use Bristol stool type 1–7 for today’s typical bowel movement.", type:"scale", min:1, max:7},
  {key:"stress", title:"How stressful was today?", prompt:"Rate your overall stress load.", options:[
    ["1","","Very low"],["2","","Low"],["3","","Moderate"],["4","","High"],["5","","Very high"]
  ]},
  {key:"activity", title:"How active were you?", prompt:"Include walking around, being on your feet and day-to-day movement.", options:[
    ["1","","Mostly resting"],["2","","Light"],["3","","Normal"],["4","","Quite active"],["5","","Very active"]
  ]},
  {key:"exercise", title:"Did you exercise?", prompt:"Anything intentional counts.", options:[
    ["0","","No"],["1","","Walk"],["2","","Run"],["3","","Gym"],["4","","Sport / other"]
  ]},
  {key:"sleepHours", title:"How long did you sleep?", prompt:"Approximate hours last night.", type:"scale", min:0, max:12},
  {key:"sleepQuality", title:"How was your sleep quality?", prompt:"How restorative did last night feel?", options:[
    ["1","","Very poor"],["2","","Poor"],["3","","Okay"],["4","","Good"],["5","","Excellent"]
  ]},
  {key:"foodNotes", title:"What have you eaten today?", prompt:"A quick summary is enough — e.g. toast, sandwich, pasta, fruit.", type:"text", placeholder:"Breakfast, lunch, dinner, snacks…"},
  {key:"foodQuality", title:"How did eating feel today?", prompt:"A simple self-rating — not a judgement of 'good' or 'bad' foods.", options:[
    ["1","","Poor fit"],["2","","Not ideal"],["3","","Mixed"],["4","","Worked well"],["5","","Very good"]
  ]}
];
let qIndex=0;

function healthScore(log){
  // Personal wellness indicator, NOT a medical disease activity score.
  // Missing items are ignored rather than scored as zero.
  const parts=[];
  const add=(value,max,weight,invert=false)=>{
    if(value===undefined || value===null || value==="") return;
    let pct=Number(value)/max;
    if(invert) pct=1-pct;
    parts.push({pct:clamp(pct,0,1),weight});
  };
  add(log.wellbeing,5,20);
  add(log.stomach,5,15);
  add(log.fatigue,5,10);
  if(log.pain!==undefined) add(log.pain,10,12,true);
  if(log.stress!==undefined) add(Number(log.stress)-1,4,10,true);
  add(log.activity,5,5);
  add(log.foodQuality,5,8);
  if(log.sleepQuality) add(log.sleepQuality,5,7);
  if(log.sleepHours!==undefined){
    const h=Number(log.sleepHours);
    // Personal target band, deliberately gentle: 7–9h gets full points.
    const sleepPct = h>=7 && h<=9 ? 1 : h<7 ? clamp(h/7,0,1) : clamp(1-(h-9)/5,0,1);
    parts.push({pct:sleepPct,weight:3});
  }
  const medVals=[log.rinvoqTaken,log.movicolTaken].filter(v=>v!==undefined);
  if(medVals.length) parts.push({pct:medVals.filter(Boolean).length/medVals.length,weight:10});
  const totalW=parts.reduce((s,p)=>s+p.weight,0);
  if(!totalW) return null;
  return Math.round(parts.reduce((s,p)=>s+p.pct*p.weight,0)/totalW*100);
}

async function saveToday(patch={}){
  Object.assign(todayLog, patch, {date:todayKey(), updatedAt:new Date().toISOString()});
  todayLog.score=healthScore(todayLog);
  await setDoc(doc(db,"users",user.uid,"dailyLogs",todayKey()), todayLog, {merge:true});
  renderToday();
}

async function loadToday(){
  const snap=await getDoc(doc(db,"users",user.uid,"dailyLogs",todayKey()));
  todayLog=snap.exists()?snap.data():{date:todayKey()};
  renderToday();
}

async function loadSettings(){
  const snap=await getDoc(doc(db,"users",user.uid,"private","settings"));
  settings=snap.exists()?snap.data():{rinvoqStock:0,movicolStock:0,rinvoqBuffer:14,movicolBuffer:7};
  $("rinvoqStock").value=settings.rinvoqStock ?? 0;
  $("movicolStock").value=settings.movicolStock ?? 0;
  $("rinvoqBuffer").value=settings.rinvoqBuffer ?? 14;
  $("movicolBuffer").value=settings.movicolBuffer ?? 7;
  renderStock();
}

function orderText(stock,buffer,label){
  stock=Number(stock||0); buffer=Number(buffer||0);
  const untilOrder=stock-buffer;
  if(stock<=0) return `No ${label} stock recorded`;
  if(untilOrder<=0) return `${stock} left · order now`;
  return `${stock} left · order in ${untilOrder} day${untilOrder===1?"":"s"}`;
}

function renderStock(){
  $("rinvoqStockText").textContent=orderText(settings.rinvoqStock,settings.rinvoqBuffer,"Rinvoq");
  $("movicolStockText").textContent=orderText(settings.movicolStock,settings.movicolBuffer,"Movicol");
}

function renderToday(){
  const score=healthScore(todayLog);
  $("scoreValue").textContent=score ?? "—";
  $("scoreRingText").textContent=score ?? "—";
  $("scoreRing").style.setProperty("--score", score ?? 0);
  $("scoreLabel").textContent=score===null?"Complete today’s check-in to build your score.":(
    score>=85?"A strong day in your personal tracker.":
    score>=70?"Looking fairly balanced today.":
    score>=55?"A mixed day — worth noticing the context.":
    "A tougher day in your log. Be gentle with yourself."
  );
  renderMed("rinvoq");
  renderMed("movicol");
}

function renderMed(med){
  const taken=todayLog[med+"Taken"];
  const btn=$(med+"Button"), stat=$(med+"Status");
  btn.classList.toggle("done",!!taken);
  stat.textContent=taken?`Taken ${todayLog[med+"Time"]||""}`:"Not logged yet";
}

async function toggleMedication(med){
  const currently=!!todayLog[med+"Taken"];
  const patch={};
  patch[med+"Taken"]=!currently;
  patch[med+"Time"]=!currently?nowTime():null;

  if(!currently){
    const stockKey=med+"Stock";
    settings[stockKey]=Math.max(0,Number(settings[stockKey]||0)-1);
    await setDoc(doc(db,"users",user.uid,"private","settings"),settings,{merge:true});
  } else {
    const stockKey=med+"Stock";
    settings[stockKey]=Number(settings[stockKey]||0)+1;
    await setDoc(doc(db,"users",user.uid,"private","settings"),settings,{merge:true});
  }
  await saveToday(patch); renderStock();
  toast(!currently?`${med==="rinvoq"?"Rinvoq":"Movicol"} logged ✓`:"Medication entry undone");
}

function renderQuestion(){
  const q=questions[qIndex];
  $("questionTitle").textContent=q.title;
  $("questionPrompt").textContent=q.prompt;
  $("questionCount").textContent=`${qIndex+1}/${questions.length}`;
  $("progressBar").style.width=`${((qIndex)/questions.length)*100}%`;
  $("backQuestion").style.visibility=qIndex===0?"hidden":"visible";
  const area=$("answerArea"); area.innerHTML="";

  if(q.type==="scale"){
    const wrap=document.createElement("div"); wrap.className="answer-grid wide-options";
    for(let v=q.min;v<=q.max;v++){
      const b=document.createElement("button"); b.className="answer-button"; b.textContent=v;
      if(Number(todayLog[q.key])===v)b.classList.add("selected");
      b.onclick=()=>answerQuestion(q.key,v);
      wrap.appendChild(b);
    }
    area.appendChild(wrap);
  }else if(q.type==="text"){
    const input=document.createElement("textarea");
    input.className="text-entry";
    input.rows=4;
    input.placeholder=q.placeholder||"";
    input.value=todayLog[q.key]||"";
    const save=document.createElement("button");
    save.className="primary";
    save.textContent="Save & continue";
    save.onclick=()=>answerQuestion(q.key,input.value.trim());
    area.append(input,save);
  }else{
    const wrap=document.createElement("div"); wrap.className="answer-grid";
    if(q.options.length<=4) wrap.classList.add("wide-options");
    q.options.forEach(([value,emoji,label])=>{
      const b=document.createElement("button"); b.className="answer-button";
      if(String(todayLog[q.key])===String(value))b.classList.add("selected");
      b.innerHTML=`${emoji?`<span class="emoji">${emoji}</span>`:""}<span>${label}</span>`;
      b.onclick=()=>answerQuestion(q.key,Number(value));
      wrap.appendChild(b);
    });
    area.appendChild(wrap);
  }
}

async function answerQuestion(key,value){
  await saveToday({[key]:value});
  if(qIndex<questions.length-1){qIndex++;renderQuestion();}
  else{
    $("progressBar").style.width="100%";
    $("questionTitle").textContent="Check-in complete";
    $("questionPrompt").textContent=`Today’s Daily Balance is ${healthScore(todayLog) ?? "—"}/100. You can revisit any answer at any time.`;
    $("answerArea").innerHTML=`<button class="secondary" id="restartCheckin">Review answers</button>`;
    $("restartCheckin").onclick=()=>{qIndex=0;renderQuestion();};
    toast("Daily check-in complete ✓");
  }
}

async function fetchNews(){
  try{
    const res=await fetch(`./news.json?t=${Date.now()}`,{cache:"no-store"});
    const items=await res.json();
    const headlines=items.slice(0,8).map(x=>x.title).join("   •   ");
    $("tickerTrack").textContent=headlines || "No headlines available.";
    $("newsGrid").innerHTML=items.slice(0,20).map(x=>`
      <a class="news-card" href="${x.link}" target="_blank" rel="noopener noreferrer">
        <p class="eyebrow">${escapeHtml(x.source||"NEWS")}</p>
        <h2>${escapeHtml(x.title)}</h2>
        <div class="news-meta">${escapeHtml(x.published||"")}</div>
      </a>`).join("");
  }catch{
    $("tickerTrack").textContent="News refresh unavailable right now.";
    $("newsGrid").innerHTML=`<article class="card"><p class="muted">Could not load the latest headlines.</p></article>`;
  }
}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

async function loadLogs(days=30){
  const q=query(collection(db,"users",user.uid,"dailyLogs"),orderBy("date","desc"),limit(days));
  const snap=await getDocs(q);
  return snap.docs.map(d=>d.data()).sort((a,b)=>a.date.localeCompare(b.date));
}

async function renderInsights(days=selectedRange){
  const logs=await loadLogs(days);
  const labels=logs.map(x=>niceDate(x.date));
  if(chartScore) chartScore.destroy();
  chartScore=new Chart($("scoreChart"),{
    type:"line",data:{labels,datasets:[{label:"Daily Balance",data:logs.map(x=>x.score??null),tension:.35,spanGaps:true}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{min:0,max:100}}}
  });
  if(chartStressSleep) chartStressSleep.destroy();
  chartStressSleep=new Chart($("stressSleepChart"),{
    type:"line",data:{labels,datasets:[
      {label:"Stress (1–5)",data:logs.map(x=>x.stress??null),tension:.3},
      {label:"Sleep quality (1–5)",data:logs.map(x=>x.sleepQuality??null),tension:.3}
    ]},options:{responsive:true,scales:{y:{min:1,max:5}}}
  });
  if(chartBowel) chartBowel.destroy();
  chartBowel=new Chart($("bowelChart"),{
    type:"line",data:{labels,datasets:[
      {label:"Bowel movements",data:logs.map(x=>x.bowelCount??null),tension:.25},
      {label:"Bristol type",data:logs.map(x=>x.consistency??null),tension:.25}
    ]},options:{responsive:true,scales:{y:{min:0,max:10}}}
  });

  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  const scores=logs.map(x=>x.score).filter(Number.isFinite);
  const stress=logs.map(x=>x.stress).filter(Number.isFinite);
  const bowel=logs.map(x=>x.bowelCount).filter(Number.isFinite);
  const sleep=logs.map(x=>x.sleepHours).filter(Number.isFinite);
  const adherence=logs.flatMap(x=>[x.rinvoqTaken,x.movicolTaken]).filter(v=>v!==undefined);
  const medPct=adherence.length?Math.round(adherence.filter(Boolean).length/adherence.length*100):null;
  $("insightCards").innerHTML=[
    ["Average score",scores.length?Math.round(avg(scores)):"—"],
    ["Average stress",stress.length?avg(stress).toFixed(1):"—"],
    ["Average sleep",sleep.length?`${avg(sleep).toFixed(1)}h`:"—"],
    ["Bowel movements",bowel.length?avg(bowel).toFixed(1):"—"],
    ["Medication logged",medPct!==null?`${medPct}%`:"—"]
  ].map(([label,value])=>`<article class="mini-insight"><p class="eyebrow">${label}</p><strong>${value}</strong><small class="muted">Selected period</small></article>`).join("");
}

async function renderHistory(){
  const logs=(await loadLogs(90)).reverse();
  $("historyList").innerHTML=logs.length?logs.map(l=>`
    <article class="history-day">
      <header><strong>${niceDate(l.date)}</strong><strong>${l.score??"—"}/100</strong></header>
      <div class="chips">
        ${l.rinvoqTaken?'<span class="chip">Rinvoq ✓</span>':""}
        ${l.movicolTaken?'<span class="chip">Movicol ✓</span>':""}
        ${l.wellbeing?`<span class="chip">Wellbeing ${l.wellbeing}/5</span>`:""}
        ${l.stress?`<span class="chip">Stress ${l.stress}/5</span>`:""}
        ${l.bowelCount!==undefined?`<span class="chip">${l.bowelCount} bowel movement${l.bowelCount===1?"":"s"}</span>`:""}
        ${l.consistency?`<span class="chip">Bristol ${l.consistency}</span>`:""}
      </div>
    </article>`).join(""):`<article class="card"><p class="muted">Your saved days will appear here.</p></article>`;
}

async function quickBowelSave(){
  const entry={
    timestamp:new Date().toISOString(),
    date:todayKey(),
    consistency:Number($("quickConsistency").value),
    urgency:Number($("quickUrgency").value),
    blood:$("quickBlood").checked,
    mucus:$("quickMucus").checked
  };
  await addDoc(collection(db,"users",user.uid,"bowelEvents"),entry);
  const newCount=Number(todayLog.bowelCount||0)+1;
  await saveToday({bowelCount:newCount,consistency:entry.consistency});
  toast("Bowel movement logged");
}

async function exportAllData(){
  const logs=await getDocs(collection(db,"users",user.uid,"dailyLogs"));
  const bowel=await getDocs(collection(db,"users",user.uid,"bowelEvents"));
  const payload={
    exportedAt:new Date().toISOString(),
    dailyLogs:logs.docs.map(d=>d.data()),
    bowelEvents:bowel.docs.map(d=>d.data()),
    medicationSettings:settings
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`my-health-export-${todayKey()}.json`; a.click(); URL.revokeObjectURL(a.href);
}

function bindUI(){
  $("rinvoqButton").onclick=()=>toggleMedication("rinvoq");
  $("movicolButton").onclick=()=>toggleMedication("movicol");
  $("skipQuestion").onclick=()=>{if(qIndex<questions.length-1){qIndex++;renderQuestion();}};
  $("backQuestion").onclick=()=>{if(qIndex>0){qIndex--;renderQuestion();}};
  $("quickBowel").onclick=()=>$("bowelDialog").showModal();
  $("quickConsistency").oninput=e=>$("consistencyOutput").textContent=e.target.value;
  $("saveBowel").onclick=async(e)=>{e.preventDefault();await quickBowelSave();$("bowelDialog").close();};
  $("openStock").onclick=()=>switchTab("more");
  $("saveStock").onclick=async()=>{
    settings={
      ...settings,
      rinvoqStock:Number($("rinvoqStock").value||0),
      movicolStock:Number($("movicolStock").value||0),
      rinvoqBuffer:Number($("rinvoqBuffer").value||14),
      movicolBuffer:Number($("movicolBuffer").value||7)
    };
    await setDoc(doc(db,"users",user.uid,"private","settings"),settings,{merge:true});
    renderStock(); toast("Prescription tracker updated");
  };
  $("exportData").onclick=exportAllData;
  $("signOutButton").onclick=()=>signOut(auth);
  $("profileButton").onclick=()=>switchTab("more");

  document.querySelectorAll(".bottom-nav button").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  document.querySelectorAll("#rangeSelector button").forEach(b=>b.onclick=async()=>{
    document.querySelectorAll("#rangeSelector button").forEach(x=>x.classList.remove("active"));
    b.classList.add("active"); selectedRange=Number(b.dataset.days); await renderInsights(selectedRange);
  });
}

async function switchTab(name){
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".bottom-nav button").forEach(x=>x.classList.remove("active"));
  $(`tab-${name}`).classList.add("active");
  document.querySelector(`.bottom-nav button[data-tab="${name}"]`)?.classList.add("active");
  if(name==="insights") await renderInsights(selectedRange);
  if(name==="history") await renderHistory();
  window.scrollTo({top:0,behavior:"smooth"});
}

$("showRegister").onclick=()=>$("registerForm").classList.toggle("hidden");
$("loginForm").onsubmit=async(e)=>{
  e.preventDefault();
  try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value);}
  catch(err){toast("Could not sign in. Check your details.");}
};
$("registerForm").onsubmit=async(e)=>{
  e.preventDefault();
  try{
    const cred=await createUserWithEmailAndPassword(auth,$("registerEmail").value.trim(),$("registerPassword").value);
    const name=$("registerName").value.trim();
    if(name) await updateProfile(cred.user,{displayName:name});
  }catch(err){toast(err.code?.replace("auth/","").replaceAll("-"," ")||"Could not create account.");}
};

onAuthStateChanged(auth,async(u)=>{
  user=u;
  if(!u){authView.classList.remove("hidden");appView.classList.add("hidden");return;}
  authView.classList.add("hidden");appView.classList.remove("hidden");
  const hour=new Date().getHours();
  $("greeting").textContent=`Good ${hour<12?"morning":hour<18?"afternoon":"evening"}${u.displayName?`, ${u.displayName.split(" ")[0]}`:""}`;
  $("todayDate").textContent=new Date().toLocaleDateString([], {weekday:"long",day:"numeric",month:"long"}).toUpperCase();
  $("accountName").textContent=u.displayName||"Your account";
  $("accountEmail").textContent=u.email||"";
  $("profileButton").textContent=(u.displayName||u.email||"H")[0].toUpperCase();
  await Promise.all([loadSettings(),loadToday(),fetchNews()]);
  qIndex=0; renderQuestion();
});

bindUI();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
