/* ============================================================
   ÉLAN — app.js  (vanilla, localStorage, PWA hors-ligne)
   Suivi de la pesée du matin, composition corporelle,
   sport, compléments et objectifs.
   ============================================================ */
'use strict';

/* ============================================================
   STOCKAGE
   ------------------------------------------------------------
   Une seule clé JSON dans localStorage. Tout ce qui peut être
   calculé (moyennes, tendances, IMC, ETA, pilulier du jour…)
   est TOUJOURS dérivé : on ne stocke que des saisies et des
   décisions. Le jeton de synchro vit à part (elan.sync) et ne
   sort jamais dans un export.
   ============================================================ */
const KEY='elan.v1', K_PREV='elan.backup.prev', K_SYNC='elan.sync';
const CURRENT_SCHEMA=1;
let saveTimer=null, STORAGE_FAIL=false;

/* Collections de données. Ajouter ici = export/import/fusion suivent automatiquement. */
const COLLECTIONS=[
  {key:'entries',      label:'Pesées',              dedupe:'date'},
  {key:'sessions',     label:'Séances',             dedupe:'id'},
  {key:'activities',   label:'Activités',           dedupe:'key'},
  {key:'plans',        label:'Entraînements prévus',dedupe:'id'},
  {key:'planOccs',     label:'Séances pointées',    dedupe:'key'},
  {key:'meds',         label:'Produits',            dedupe:'id'},
  {key:'medGroups',    label:'Groupes de prises',   dedupe:'id'},
  {key:'medSchedules', label:'Créneaux de prise',   dedupe:'id'},
  {key:'medIntakes',   label:'Prises',              dedupe:'id'},
  {key:'motivations',  label:'Motivations',         dedupe:'id'},
  {key:'milestones',   label:'Paliers franchis',    dedupe:'code'}
];

/* `state` est chargé au boot, PAS ici : migrate() utilise le registre METRICS, déclaré plus bas.
   Charger trop tôt reviendrait à lire les données avant que le registre existe — et, l'erreur
   étant avalée, à repartir d'une base vide. Un bug silencieux qui coûterait des mois de saisie. */
let state=null, LOAD_ERROR=null;

function load(){
  let raw=null;
  try{ raw=localStorage.getItem(KEY); }catch(e){}
  if(raw){
    try{ return migrate(JSON.parse(raw)); }
    catch(e){
      /* On ne perd JAMAIS les données : on met la version illisible de côté et on prévient. */
      try{ localStorage.setItem('elan.rescue',raw); }catch(_){}
      LOAD_ERROR=String((e&&e.message)||e);
    }
  }
  return migrate(defaultDB());
}
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,200); }
function saveNow(){
  clearTimeout(saveTimer);
  /* Si on n'a pas su RELIRE la base, on refuse d'écrire par-dessus : ce serait
     transformer une lecture ratée en perte définitive. On rouvre l'écriture
     seulement quand l'utilisateur choisit explicitement (import, restauration, effacement). */
  if(LOAD_ERROR) return false;
  const ok=safeSet(KEY,JSON.stringify(state));
  if(ok&&STORAGE_FAIL){ STORAGE_FAIL=false; render(); }
  return ok;
}
/* Toute mutation réelle passe par update() : +1 de révision, enregistrement, re-rendu. */
function touch(){ state.meta.rev=(state.meta.rev|0)+1; state.meta.updatedAt=new Date().toISOString(); }
function update(){ touch(); invalidateCache(); save(); render(); }

function isQuota(e){ return !!e && (e.name==='QuotaExceededError'||e.name==='NS_ERROR_DOM_QUOTA_REACHED'||e.code===22||e.code===1014); }
/* Si le stockage sature, on sacrifie les instantanés — jamais elan.v1 ni elan.sync. */
const SACRIFICE=['elan.snap.3','elan.snap.2','elan.snap.1',K_PREV];
function safeSet(key,str){
  try{ localStorage.setItem(key,str); return true; }catch(e){ if(!isQuota(e)) return false; }
  for(let i=0;i<SACRIFICE.length;i++){
    if(SACRIFICE[i]===key) continue;
    try{ localStorage.removeItem(SACRIFICE[i]); }catch(_){}
    try{ localStorage.setItem(key,str); toast('Stockage saturé — un ancien instantané a été supprimé'); return true; }
    catch(e2){ if(!isQuota(e2)) return false; }
  }
  if(key===KEY){ STORAGE_FAIL=true; }
  return false;
}
function storageBanner(){
  if(LOAD_ERROR){
    return '<div class="card card--danger" style="margin-bottom:12px">'
      +'<div class="row-title flex aic gap8">'+ic('alert')+'Données illisibles</div>'
      +'<div class="small muted" style="margin:6px 0 10px">Élan n’a pas réussi à relire ta base ('+esc(LOAD_ERROR)+'). '
      +'Rien n’a été effacé : la version d’origine est conservée sur l’appareil. Importe ta dernière sauvegarde, ou contacte-moi avant de saisir quoi que ce soit.</div>'
      +'<button class="btn btn--danger btn--block" data-act="go" data-route="/sauvegarde">Ouvrir la sauvegarde</button></div>';
  }
  if(!STORAGE_FAIL) return '';
  return '<div class="card card--danger" style="margin-bottom:12px">'
    +'<div class="row-title flex aic gap8">'+ic('alert')+'Enregistrement impossible</div>'
    +'<div class="small muted" style="margin:6px 0 10px">Le stockage de cet iPhone est plein. Tes dernières saisies risquent d\'être perdues à la fermeture. Exporte une sauvegarde maintenant.</div>'
    +'<button class="btn btn--danger btn--block" data-act="bk-share">'+ic('upload')+'Exporter tout de suite</button></div>';
}

function defaultDB(){
  const today=isoToday();
  return {
    schemaVersion:CURRENT_SCHEMA,
    settings:{
      profile:{ firstName:null, sex:'m', heightCm:182, birthYear:null, job:'bureau' },
      tabs:['/','/courbes','/tableau','/plus'],
      goal:{ weightKg:null, date:null, fatPct:null, mode:'lose', maintainBandKg:1.5 },
      startOverride:null,                 // {date, weightKg} pour figer soi-même son point de départ
      heroMode:'raw',                     // 'raw' = le chiffre de la balance, 'trend' = la tendance lissée
      sparkDays:60,
      metrics:{ weight:true, fat:true, water:true, muscle:true, bone:true, kcalOut:true,
                lean:false, protein:false, protIn:false, visceral:false, bmr:false, metaAge:false,
                waist:false, hips:false, chest:false, arm:false, thigh:false, neck:false,
                steps:false, sleep:false, mood:false },
      modules:{ sport:false, kcalIn:false, pillbox:false, planning:false },
      /* Unité mise en avant pour chaque métrique double. Ne réécrit JAMAIS l'historique. */
      metricUnitPref:{ fat:'pct', water:'pct', muscle:'pct', bone:'kg', protein:'pct', lean:'kg' },
      convertFallback:'lastKnown',        // conversion %↔kg quand le poids du jour manque
      convertFallbackDays:7,
      energy:{ palMode:'auto', pal:'leg' },
      sport:{ startedAt:null, weeklyGoalMin:150, weeklyGoalSessions:3, defaultDurationMin:45,
              kcalMode:'estimate' },
      planning:{ floorDate:null, horizonDays:14, remindOnBoot:true, confirmWindowH:36 },
      pillbox:{ floorDate:null, showOnHome:true, dayCutoffHour:4, lateAfterMin:60,
                momentTimes:{matin:'08:00',midi:'12:30',gouter:'16:30',soir:'19:30',coucher:'22:30'},
                mealTimes:{petitdej:'08:00',dejeuner:'12:30',gouter:'16:30',diner:'19:30'},
                defaultWorkoutTime:'18:30', defaultSessionMin:60, countAsNeeded:false },
      accentTheme:'vert', density:'comfortable', numberPrivacy:false, hapticsOn:true,
      celebrateOn:true, reduceMotion:null, firstScreen:'/', onboardingDone:false
    },
    ui:{ charts:{}, table:{}, insightSeen:{}, skippedDays:{}, hints:{},
         backupSnoozeUntil:null, pillCelebratedOn:null, lastActivityKey:null, 
         etaShown:null, sportPeriod:7, sportMonth:null, pillTab:'jour', pillDate:null, pillWeek:null,
         weekStart:null,
         analyseTab:'progression' },
    meta:{ appVersion:'1.3', deviceId:null, deviceName:'', rev:0, updatedAt:null, createdAt:today,
           lastBackupAt:null, lastCloudAt:null, lastSnapAt:null, lastOpenAt:null, openCount:0 },
    entries:[], sessions:[], activities:[], plans:[], planOccs:[],
    meds:[], medGroups:[], medSchedules:[], medIntakes:[], motivations:[], milestones:[]
  };
}

function migrate(db){
  const d=defaultDB();
  db=Object.assign({},d,db||{});
  db.settings=deepDefaults(db.settings,d.settings);
  db.ui=deepDefaults(db.ui,d.ui);
  db.meta=Object.assign({},d.meta,db.meta||{});
  db.meta.appVersion=d.meta.appVersion;      // la version vient du code, jamais de la sauvegarde
  COLLECTIONS.forEach(c=>{ if(!Array.isArray(db[c.key])) db[c.key]=[]; });
  if(!db.activities.length) db.activities=seedActivities();
  if(!db.meta.deviceId) db.meta.deviceId=uid();
  if(!db.meta.createdAt) db.meta.createdAt=isoToday();
  if(!db.settings.pillbox.floorDate) db.settings.pillbox.floorDate=isoToday();
  if(!db.settings.planning.floorDate) db.settings.planning.floorDate=isoToday();
  /* Normalisation des pesées : une seule par date, triées, valeurs propres.
     Le nettoyage est fait AVANT toute fusion de doublon, sans quoi une valeur
     invalide venue du doublon entrerait dans la base sans passer par le filtre. */
  const cleanEntry=e=>{
    if(!e.id) e.id=uid();
    if(!e.m||typeof e.m!=='object') e.m={};
    if(!Array.isArray(e.tags)) e.tags=[];
    /* Une valeur absente = clé absente. Jamais null, jamais 0 par défaut. */
    Object.keys(e.m).forEach(k=>{
      const x=e.m[k];
      if(!x||typeof x!=='object'||typeof x.v!=='number'||!isFinite(x.v)||!METRICS[k]||METRICS[k].kind==='derived'){ delete e.m[k]; return; }
      if(!x.u) x.u=defaultUnitOf(k);
    });
    return e;
  };
  const seen={};
  db.entries=db.entries.filter(e=>{
    if(!e||typeof e!=='object'||!validYMD(e.date)) return false;
    cleanEntry(e);
    if(seen[e.date]){                                   // doublon d'import : le plus récent l'emporte
      const prev=seen[e.date];
      if(String(e.updatedAt||'')>String(prev.updatedAt||'')) Object.assign(prev.m,e.m);
      else Object.keys(e.m).forEach(k=>{ if(prev.m[k]===undefined) prev.m[k]=e.m[k]; });
      return false;
    }
    seen[e.date]=e;
    return true;
  });
  db.entries.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  /* Réparations douces */
  const gids={}; db.medGroups.forEach(g=>gids[g.id]=1);
  db.medSchedules.forEach(sc=>{ if(sc.groupId&&!gids[sc.groupId]) sc.groupId=null;
    if(!sc.anchor) sc.anchor={type:'moment',moment:'matin',dir:'after',offsetMin:0};
    if(!sc.recurrence) sc.recurrence={type:'daily',days:[],n:2,anchorDate:sc.startDate||isoToday()};
    if(sc.active===undefined) sc.active=true; if(sc.priority===undefined) sc.priority=0; });
  db.meds.forEach((m,i)=>{ if(!m.startDate) m.startDate=isoToday(); if(m.endDate===undefined) m.endDate=null;
    if(m.active===undefined) m.active=true; if(m.archived===undefined) m.archived=false;
    if(m.sortOrder===undefined) m.sortOrder=i; if(m.dose===undefined) m.dose=''; });
  db.medIntakes.forEach(it=>{ if(it.offPlan===undefined) it.offPlan=false; if(!it.status) it.status='taken'; });
  db.schemaVersion=CURRENT_SCHEMA;
  return db;
}
/* Fusion récursive des valeurs par défaut, à toute profondeur : les horaires du
   pilulier sont imbriqués à trois niveaux et doivent être complétés eux aussi. */
function deepDefaults(cur,def){
  const out=Object.assign({},def,cur||{});
  for(const k in def){
    const d=def[k];
    if(d&&typeof d==='object'&&!Array.isArray(d)){
      const c=(cur&&cur[k]&&typeof cur[k]==='object'&&!Array.isArray(cur[k]))?cur[k]:{};
      out[k]=deepDefaults(c,d);
    }
  }
  return out;
}

/* @@SECTION:STOCKAGE@@ */

/* ---------- Helpers généraux ---------- */
function uid(){ return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():'id-'+Math.random().toString(36).slice(2)+Date.now().toString(36); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function q(sel,root){ return (root||document).querySelector(sel); }
function qa(sel,root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function isNum(v){ return typeof v==='number' && isFinite(v); }
function motionOff(){ return document.documentElement.dataset.motion==='off' || (state.settings.reduceMotion===true) ||
  (state.settings.reduceMotion==null && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
function haptic(ms){ try{ if(state.settings.hapticsOn!==false && navigator.vibrate) navigator.vibrate(ms||12); }catch(e){} }

/* Nombres au format français. `dec` = nombre de décimales. */
const NBSP=' ';   // espace fine insécable
function nf(v,dec){ dec=dec==null?1:dec; return new Intl.NumberFormat('fr-FR',{minimumFractionDigits:dec,maximumFractionDigits:dec}).format(v); }
function num(v,dec){ return isNum(v)?nf(v,dec):'—'; }
function numSigned(v,dec){ if(!isNum(v)) return '—'; return (v>0?'+':(v<0?'−':''))+nf(Math.abs(v),dec==null?1:dec); }
function round(v,dec){ if(!isNum(v)) return null; const p=Math.pow(10,dec==null?1:dec); return Math.round(v*p)/p; }
/* Lit un nombre saisi : accepte « 82,4 », « 82.4 », « 82,4 kg » ; vide → null. */
function parseNum(v){ if(v==null) return null; let s=String(v).trim().replace(/\s/g,'').replace(',','.').replace(/[^0-9.\-]/g,'');
  if(s===''||s==='-'||s==='.') return null; const f=parseFloat(s); return isFinite(f)?f:null; }

/* ============================================================
   ICÔNES
   ------------------------------------------------------------
   Un seul jeu vectoriel, dessiné à la même grille (24×24, trait
   1,75, bouts ronds). Les emoji ne subsistent QUE là où c'est
   l'utilisateur qui les a choisis : ses activités, ses produits,
   ses raisons. Partout ailleurs — navigation, mesures, sections,
   états vides — c'est une icône. Deux registres visuels nets
   valent mieux qu'un mélange des deux à chaque ligne.
   ============================================================ */
const ICONS={
  /* — Navigation et gestes — */
  home:'<path d="M3.6 10.4 12 3.5l8.4 6.9"/><path d="M5.7 9.5V19a1.4 1.4 0 0 0 1.4 1.4h9.8a1.4 1.4 0 0 0 1.4-1.4V9.5"/><path d="M9.8 20.4v-4.9a2.2 2.2 0 0 1 4.4 0v4.9"/>',
  chart:'<path d="M3.4 17.6 9 11.2l3.8 3.6 7.4-8.2"/><path d="M20.2 6.6h-4.1M20.2 6.6v4.1"/>',
  table:'<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="3"/><path d="M3.4 9.5h17.2M3.4 14.6h17.2M9.3 4.4v15.2"/>',
  grid:'<rect x="4" y="4" width="6.2" height="6.2" rx="2"/><rect x="13.8" y="4" width="6.2" height="6.2" rx="2"/><rect x="4" y="13.8" width="6.2" height="6.2" rx="2"/><rect x="13.8" y="13.8" width="6.2" height="6.2" rx="2"/>',
  chevron:'<path d="M9.2 5.6 15.6 12l-6.4 6.4"/>',
  back:'<path d="M15 5 8 12l7 7"/>',
  plus:'<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  minus:'<path d="M5.2 12h13.6"/>',
  check:'<path d="M4.9 12.7 9.6 17.4 19.1 6.9"/>',
  close:'<path d="M6.3 6.3 17.7 17.7M17.7 6.3 6.3 17.7"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.4"/><path d="m15.4 15.4 4.2 4.2"/>',
  settings:'<circle cx="12" cy="12" r="3.1"/><path d="M19.5 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.7-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1.1-2.7l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9Z"/>',
  help:'<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.5a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2.4-2.3 2.4"/><path d="M12 16.6h.01"/>',
  info:'<circle cx="12" cy="12" r="8.4"/><path d="M12 11.2v5M12 7.8h.01"/>',
  alert:'<path d="M10.6 3.9 2.9 17a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z"/><path d="M12 9.4v3.8M12 16.6h.01"/>',
  ban:'<circle cx="12" cy="12" r="8.4"/><path d="m6.1 6.1 11.8 11.8"/>',

  /* — Le corps et ses mesures — */
  scale:'<path d="M12 4.4v15.2"/><path d="M7.4 19.6h9.2"/><path d="M4.4 7.9 12 6l7.6 1.9"/><path d="M4.4 7.9 1.9 13.8h5"/><path d="M19.6 7.9 17.1 13.8h5"/><circle cx="12" cy="4.4" r="1.4"/>',
  flame:'<path d="M12 3.4c3 3.6 5 6.3 5 9.2a5 5 0 0 1-10 0c0-1.7.6-3.1 1.7-4.5.5 1.2 1.2 1.9 2 2.1.3-2.5-.2-4.7 1.3-6.8Z"/>',
  droplet:'<path d="M12 3.6c3.3 3.9 5.2 6.5 5.2 9a5.2 5.2 0 0 1-10.4 0c0-2.5 1.9-5.1 5.2-9Z"/>',
  dumbbell:'<rect x="2.2" y="9.6" width="2.8" height="4.8" rx="1.1"/><rect x="19" y="9.6" width="2.8" height="4.8" rx="1.1"/><rect x="5.6" y="7.4" width="3.2" height="9.2" rx="1.4"/><rect x="15.2" y="7.4" width="3.2" height="9.2" rx="1.4"/><path d="M8.8 12h6.4"/>',
  bone:'<path d="M14.5 9.5 9.5 14.5"/><path d="M9.9 16.3a2.3 2.3 0 1 1-2.2-2.2 2.3 2.3 0 1 1 2.2 2.2Z"/><path d="M16.3 9.9a2.3 2.3 0 1 0-2.2-2.2 2.3 2.3 0 1 0 2.2 2.2Z"/>',
  egg:'<path d="M12 3.6c3.1 0 5.5 4.5 5.5 8.1a5.5 5.5 0 0 1-11 0c0-3.6 2.4-8.1 5.5-8.1Z"/>',
  ruler:'<path d="M3.3 14.5 14.5 3.3a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L9.5 20.7a1.6 1.6 0 0 1-2.3 0l-3.9-3.9a1.6 1.6 0 0 1 0-2.3Z"/><path d="m7.6 10.2 1.8 1.8M10.6 7.2l1.8 1.8M13.6 4.2l1.8 1.8M4.6 13.2l1.8 1.8"/>',
  heart:'<path d="M12 19.9 4.6 12.6a4.4 4.4 0 0 1 6.2-6.2l1.2 1.2 1.2-1.2a4.4 4.4 0 0 1 6.2 6.2Z"/>',
  gauge:'<path d="M4.2 17.4a8.6 8.6 0 1 1 15.6 0"/><path d="m12 13.4 3.6-3.8"/><circle cx="12" cy="14.4" r="1.1"/>',
  moon:'<path d="M20.2 13.4A8.2 8.2 0 0 1 10.6 3.8a8.4 8.4 0 1 0 9.6 9.6Z"/>',
  steps:'<path d="M7.4 4.4c1.6 0 2.6 1.3 2.6 3.2 0 1.5-.5 2.4-.5 3.6 0 .9.4 1.5.4 2.3 0 1.1-1 1.7-2.5 1.7s-2.5-.6-2.5-1.7c0-.8.4-1.4.4-2.3 0-1.2-.5-2.1-.5-3.6 0-1.9 1-3.2 2.6-3.2Z"/><path d="M16.6 9.2c1.6 0 2.6 1.3 2.6 3.2 0 1.5-.5 2.4-.5 3.6 0 .9.4 1.5.4 2.3 0 1.1-1 1.7-2.5 1.7s-2.5-.6-2.5-1.7c0-.8.4-1.4.4-2.3 0-1.2-.5-2.1-.5-3.6 0-1.9 1-3.2 2.6-3.2Z"/>',

  /* — Énergie et alimentation — */
  battery:'<rect x="2.6" y="7.6" width="15.6" height="8.8" rx="2.8"/><path d="M21.4 10.6v2.8"/><path d="M6 10.9v2.2M9.2 10.9v2.2"/>',
  plate:'<path d="M6.4 3.4v6.2a2.4 2.4 0 0 0 4.8 0V3.4"/><path d="M8.8 9.9v10.7"/><path d="M17.6 3.4c-1.6 1-2.6 2.8-2.6 4.9 0 1.7.8 2.8 2.2 3.1v9.2"/>',
  meat:'<path d="M4.8 13.6a7.2 7.2 0 0 1 7.2-7.2c4.1 0 7.2 2.6 7.2 6.1 0 3.4-2.8 5.9-6.3 5.9H8.2a3.4 3.4 0 0 1-3.4-3.4Z"/><path d="M8.6 12.2a3 3 0 0 1 3-2.6"/>',
  bolt:'<path d="M13.4 2.6 4.8 13.2h6.2l-.4 8.2 8.6-10.6h-6.2Z"/>',
  target:'<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1"/>',
  calculator:'<rect x="4.6" y="2.8" width="14.8" height="18.4" rx="3"/><path d="M8.2 7.2h7.6"/><path d="M8.6 11.6h.01M12 11.6h.01M15.4 11.6h.01M8.6 15.4h.01M12 15.4h.01M15.4 15.4h.01M8.6 18.4h3.4"/>',

  /* — Temps, activité, planification — */
  run:'<circle cx="14.4" cy="4.9" r="2"/><path d="M9.4 20.6l2.2-5-2.6-2.4.9-4.9 3.5 2.2 2.9.6"/><path d="M11.9 12.9 8.2 11l-3 2.4"/><path d="m13.6 15.6 3.4 1.5 1.4 3.5"/>',
  calendar:'<rect x="3.4" y="5" width="17.2" height="15.4" rx="3"/><path d="M3.4 9.8h17.2M8.4 3.2v3.6M15.6 3.2v3.6"/>',
  clock:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/>',
  hourglass:'<path d="M7 3.4h10M7 20.6h10"/><path d="M7.6 3.4v3.1c0 2 1.6 3.2 3.2 4.4.8.6.8 1.6 0 2.2-1.6 1.2-3.2 2.4-3.2 4.4v3.1"/><path d="M16.4 3.4v3.1c0 2-1.6 3.2-3.2 4.4-.8.6-.8 1.6 0 2.2 1.6 1.2 3.2 2.4 3.2 4.4v3.1"/>',
  history:'<path d="M3.6 12a8.4 8.4 0 1 0 2.5-6"/><path d="M3.4 4.2v4.2h4.2"/><path d="M12 8v4.2l2.9 1.7"/>',
  sprout:'<path d="M12 20.4v-6.6"/><path d="M12 13.8C12 10.3 9.4 7.7 5.9 7.7c0 3.5 2.6 6.1 6.1 6.1Z"/><path d="M12 13.2c0-3.2 2.4-5.6 5.6-5.6.2 3.2-2.2 5.6-5.6 5.6Z"/>',

  /* — Suivi, données, outils — */
  /* Gélule tracée directement en diagonale : un transform="rotate(...)" dans une
     icône se combine mal avec les transformations CSS appliquées au SVG. */
  pill:'<path d="m10.4 20.6 10.2-10.2a4.9 4.9 0 0 0-7-7L3.4 13.6a4.9 4.9 0 0 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  trend:'<path d="M3.4 6.6 9 13l3.8-3.6 7.4 8.2"/><path d="M20.2 17.4h-4.1M20.2 17.4v-4.1"/>',
  microscope:'<path d="M7.8 20.4h12.4"/><path d="M11.6 20.4a6 6 0 0 0 5.4-8.6"/><path d="m10.4 6.4 4.4 4.4"/><path d="M13.2 3.6 9 7.8a1.6 1.6 0 0 0 0 2.3l1.5 1.5a1.6 1.6 0 0 0 2.3 0l4.2-4.2a1.6 1.6 0 0 0 0-2.3l-1.5-1.5a1.6 1.6 0 0 0-2.3 0Z"/><path d="M5.4 20.4a5 5 0 0 1 5-5"/>',
  toolbox:'<rect x="2.8" y="7.6" width="18.4" height="12.8" rx="2.8"/><path d="M8.4 7.6V5.8a2 2 0 0 1 2-2h3.2a2 2 0 0 1 2 2v1.8"/><path d="M2.8 13.2h18.4M10 11.6v3.2M14 11.6v3.2"/>',
  bulb:'<path d="M9.4 18h5.2"/><path d="M10.2 20.6h3.6"/><path d="M8.2 12.9a4.9 4.9 0 1 1 7.6 0c-.8 1-1.2 1.7-1.3 2.6H9.5c-.1-.9-.5-1.6-1.3-2.6Z"/>',
  quote:'<path d="M9.4 6.6c-2.8 1.2-4.4 3.6-4.4 6.6v4.2h5.4v-5.4H7.2c0-1.8.8-3 2.2-3.8Z"/><path d="M19 6.6c-2.8 1.2-4.4 3.6-4.4 6.6v4.2H20v-5.4h-3.2c0-1.8.8-3 2.2-3.8Z"/>',
  trophy:'<path d="M7.4 4.2h9.2v4.4a4.6 4.6 0 1 1-9.2 0Z"/><path d="M7.4 5.8H4.8v1a3.6 3.6 0 0 0 3.4 3.6M16.6 5.8h2.6v1a3.6 3.6 0 0 1-3.4 3.6"/><path d="M12 13.2v3.2M8.6 20.4h6.8l-.8-4H9.4Z"/>',
  medal:'<circle cx="12" cy="15" r="5.2"/><path d="m8.6 10.4-3-6.8h4.2L12 7.8l2.2-4.2h4.2l-3 6.8"/><path d="M12 13.2v3.6"/>',
  sparkle:'<path d="M12 3.4 13.7 9l5.6 1.7-5.6 1.7L12 18l-1.7-5.6L4.7 10.7 10.3 9Z"/><path d="M18.6 16.6l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z"/>',

  /* — Fichiers, sauvegarde, système — */
  save:'<path d="M12 3.4v10.8M8.2 10.6 12 14.4l3.8-3.8"/><path d="M4.4 15.4v3.2a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-3.2"/>',
  upload:'<path d="M12 20.6V9.8M8.2 13.6 12 9.8l3.8 3.8"/><path d="M4.4 8.6V5.4a2 2 0 0 1 2-2h11.2a2 2 0 0 1 2 2v3.2"/>',
  cloud:'<path d="M17.2 19.2a4.6 4.6 0 0 0 .6-9.2 6.2 6.2 0 0 0-12 1.9 3.7 3.7 0 0 0 .6 7.3Z"/>',
  refresh:'<path d="M20.4 11.4A8.4 8.4 0 0 0 6.2 6.6L3.6 9"/><path d="M3.6 12.6a8.4 8.4 0 0 0 14.2 4.8l2.6-2.4"/><path d="M3.6 4.4V9h4.6M20.4 19.6V15h-4.6"/>',
  trash:'<path d="M4.4 6.6h15.2"/><path d="M9.4 6.6V5a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v1.6"/><path d="M6.4 6.6v12.2a2 2 0 0 0 2 2h7.2a2 2 0 0 0 2-2V6.6"/><path d="M10.4 10.8v5.6M13.6 10.8v5.6"/>',
  archive:'<path d="M3.4 7.6h17.2v11a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z"/><rect x="2.6" y="3.4" width="18.8" height="4.2" rx="1.6"/><path d="M10 11.6h4"/>',
  key:'<circle cx="7.6" cy="14.4" r="3.8"/><path d="m10.4 11.6 8-8"/><path d="m15.6 6.4 2.2 2.2M18 4l2.2 2.2"/>',
  phone:'<rect x="6.2" y="2.6" width="11.6" height="18.8" rx="3"/><path d="M10.6 18.4h2.8"/>',
  shuffle:'<path d="M3.6 6.6h3.2c1.4 0 2.3.7 3.2 2l3.6 6c.9 1.3 1.8 2 3.2 2h3.6"/><path d="M3.6 16.6h3.2c1.4 0 2.3-.7 3.2-2M14 8.6c.9-1.3 1.8-2 3.2-2h3.2"/><path d="M17.8 3.4 20.4 6l-2.6 2.6M17.8 14 20.4 16.6 17.8 19.2"/>',
  layers:'<path d="m12 3.4 8.6 4.4L12 12.2 3.4 7.8Z"/><path d="m3.4 12.4 8.6 4.4 8.6-4.4"/><path d="m3.4 16.6 8.6 4.4 8.6-4.4"/>',
  briefcase:'<rect x="3" y="7.2" width="18" height="13.2" rx="2.6"/><path d="M8.6 7.2V5.6a2 2 0 0 1 2-2h2.8a2 2 0 0 1 2 2v1.6"/><path d="M3 12.8h18"/>',
  bricks:'<rect x="3.2" y="5.2" width="17.6" height="4.8" rx="1.2"/><rect x="3.2" y="10" width="17.6" height="4.8" rx="1.2"/><rect x="3.2" y="14.8" width="17.6" height="4.8" rx="1.2"/><path d="M9.4 5.2v4.8M15.4 10v4.8M9.4 14.8v4.8"/>',
  walk:'<circle cx="12.8" cy="4.8" r="2"/><path d="m9 20.6 2.4-5.4-1.8-2.6.6-4 3 1.8 2.2 1.4"/><path d="m11.6 12.6-3-1.2-2 2.6"/><path d="m13.2 15.2 1.8 2 .8 3.4"/>',
  chair:'<path d="M6.4 3.6v7.2h11.2V3.6"/><path d="M4.6 10.8h14.8"/><path d="M7.2 10.8v4.6h9.6v-4.6"/><path d="M7.2 15.4v5M16.8 15.4v5"/>',
  hand:'<path d="M8.6 11.4V6.2a1.7 1.7 0 0 1 3.4 0v4.6"/><path d="M12 10.8V5.4a1.7 1.7 0 0 1 3.4 0v5.4"/><path d="M15.4 11.4V7.8a1.7 1.7 0 0 1 3.4 0v6.4a6.4 6.4 0 0 1-6.4 6.4h-.9a6 6 0 0 1-4.6-2.2l-2.8-3.6a1.7 1.7 0 0 1 2.6-2.2l1.9 2"/>'
};
/* Une icône : `ic('scale')`, ou `ic('scale','ic--lg')` pour l'agrandir. */
function ic(name,cls){
  const d=ICONS[name];
  if(!d) return '';
  return '<svg class="ic'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
}
/* ------------------------------------------------------------------
   Un emoji CHOISI PAR L'UTILISATEUR — l'émoji de son activité, de son
   produit, de sa raison. C'est le seul endroit de l'app où un emoji a
   encore le droit de s'afficher, et il passe TOUJOURS par ici.
   Le banc s'appuie dessus : il retire les `<span class="uem">` du HTML
   produit, puis exige qu'il ne reste plus un seul emoji. Sans ce
   marqueur, la règle serait une intention ; avec lui, elle est testée.
   ------------------------------------------------------------------ */
function uem(e){ return '<span class="uem">'+(e||'\u2022')+'</span>'; }

/* Une icône dans sa tuile arrondie — le motif des listes et de la grille « Plus ». */
function icTile(name,cls,tint){
  return '<div class="ic-tile'+(cls?' '+cls:'')+'"'+(tint?' style="color:'+tint+'"':'')+'>'+ic(name)+'</div>';
}

/* ---------- Dates ---------- */
const JOURS=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const JOURS_MIN=['D','L','M','M','J','V','S'];
const MOIS3=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function isoToday(){ return ymd(new Date()); }
function parseYMD(s){ const p=String(s).split('-').map(Number); return new Date(p[0],(p[1]||1)-1,p[2]||1); }
function validYMD(s){ return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
/* Numéro de jour absolu, calculé en UTC → insensible aux changements d'heure. */
function dayNum(s){ const p=String(s).split('-'); return Math.floor(Date.UTC(+p[0],(+p[1]||1)-1,+p[2]||1)/86400000); }
function numDay(n){ const d=new Date(n*86400000);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
function addDayYMD(s,n){ return numDay(dayNum(s)+n); }
function addMonthsYMD(s,k,dayPref){ const d=parseYMD(s); let y=d.getFullYear(); let m=d.getMonth()+k;
  y+=Math.floor(m/12); m=((m%12)+12)%12; let day=dayPref||d.getDate(); day=Math.min(day,daysInMonth(y,m)); return ymd(new Date(y,m,day)); }
function diffDays(a,b){ return dayNum(b)-dayNum(a); }
function dowOf(s){ return parseYMD(s).getDay(); }                 // 0 = dimanche
function isoDow(s){ return ((parseYMD(s).getDay()+6)%7)+1; }      // 1 = lundi … 7 = dimanche
function monthKey(s){ return String(s).slice(0,7); }
function weekStartYMD(s){ return addDayYMD(s,-(isoDow(s)-1)); }   // lundi de la semaine
function weekKey(s){ return weekStartYMD(s); }
function maxYMD(){ let m=''; for(let i=0;i<arguments.length;i++){ const a=arguments[i]; if(a&&a>m) m=a; } return m; }
function minYMD(){ let m=''; for(let i=0;i<arguments.length;i++){ const a=arguments[i]; if(a&&(!m||a<m)) m=a; } return m; }
function fmtDateShort(s){ return parseYMD(s).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}); }
function fmtDateLong(s){ return parseYMD(s).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}); }
function fmtDateFull(s){ return parseYMD(s).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function fmtMonth(mk){ return parseYMD(mk+'-01').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); }
function fmtTblDate(s){ const d=parseYMD(s);
  return d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.','')+' '+String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); }
function fmtDayLabel(s){ const t=isoToday();
  if(s===t) return "Aujourd'hui"; if(s===addDayYMD(t,-1)) return 'Hier'; if(s===addDayYMD(t,-2)) return 'Avant-hier'; if(s===addDayYMD(t,1)) return 'Demain';
  return parseYMD(s).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}); }
function capit(s){ return String(s||'').replace(/^./,c=>c.toUpperCase()); }
/* Durée humaine à partir d'un nombre de jours : « 2 mois et 3 jours ». */
function fmtDuration(days){
  if(!isNum(days)||days<0) return '—';
  if(days===0) return "aujourd'hui";
  if(days<31) return days+(days>1?' jours':' jour');
  const months=Math.floor(days/30.44), rest=days-Math.round(months*30.44);
  if(months<12) return months+' mois'+(rest>0?' et '+rest+(rest>1?' jours':' jour'):'');
  const years=Math.floor(months/12), mo=months-years*12;
  return years+(years>1?' ans':' an')+(mo>0?' et '+mo+' mois':'');
}
/* Durée en minutes → « 1 h 30 » */
function fmtMin(m){ if(!isNum(m)) return '—'; if(m<60) return Math.round(m)+NBSP+'min';
  const h=Math.floor(m/60), r=Math.round(m%60); return h+NBSP+'h'+(r?NBSP+String(r).padStart(2,'0'):''); }
function hhmmToMin(s){ const p=String(s||'00:00').split(':'); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }
function minToHHMM(m){ m=clamp(Math.round(m),0,1439); return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }
function nowMin(){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }
function nowHHMM(){ return minToHHMM(nowMin()); }
function fmtTime(t){ return String(t||'').replace(':','h'); }
/* Horodatage relatif : « il y a 4 min », « hier », « il y a 3 semaines » */
function agoText(iso){
  if(!iso) return 'jamais';
  const s=Math.floor((Date.now()-Date.parse(iso))/1000);
  if(s<0) return "à l'instant";
  if(s<60) return "à l'instant";
  if(s<3600) return 'il y a '+Math.floor(s/60)+' min';
  if(s<86400) return 'il y a '+Math.floor(s/3600)+' h';
  const d=Math.floor(s/86400);
  if(d===1) return 'hier';
  if(d<7) return 'il y a '+d+' jours';
  if(d<30){ const w=Math.floor(d/7); return 'il y a '+w+' semaine'+(w>1?'s':''); }
  return 'le '+new Date(iso).toLocaleDateString('fr-FR');
}
function fmtDateTime(iso){ if(!iso) return '—'; const d=new Date(iso);
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }

/* ============================================================
   REGISTRE DES MÉTRIQUES
   ------------------------------------------------------------
   kind 'comp'   : métrique de composition — saisissable EN % OU
                   EN KG, l'autre valeur étant calculée à partir
                   du poids du jour. On mémorise ce que
                   l'utilisateur a réellement tapé (src) et on ne
                   recalcule jamais son champ, seulement l'autre.
   kind 'scalar' : une seule valeur (kcal, tour de taille…).
   kind 'derived': jamais saisi (IMC, masse maigre).
   ============================================================ */
const METRICS={
  weight : {key:'weight', label:'Poids',              short:'Poids',  icon:'scale',  kind:'scalar', unit:'kg',  dec:1, better:'down', color:'var(--m-poids)',  min:20,  max:400, always:true, group:'poids'},
  fat    : {key:'fat',    label:'Masse grasse',       short:'Gras',   icon:'flame',  kind:'comp',   defUnit:'pct', dec:1, decKg:2, better:'down', color:'var(--m-gras)',   min:3,   max:70, minKg:1,  maxKg:180, group:'compo'},
  water  : {key:'water',  label:'Eau',                short:'Eau',    icon:'droplet',  kind:'comp',   defUnit:'pct', dec:1, decKg:2, better:'up',   color:'var(--m-eau)',    min:20,  max:80, minKg:8,  maxKg:150, group:'compo'},
  muscle : {key:'muscle', label:'Masse musculaire',   short:'Muscle', icon:'dumbbell',  kind:'comp',   defUnit:'pct', dec:1, decKg:2, better:'up',   color:'var(--m-muscle)', min:10,  max:75, minKg:8,  maxKg:150, group:'compo'},
  bone   : {key:'bone',   label:'Masse osseuse',      short:'Os',     icon:'bone',  kind:'comp',   defUnit:'kg',  dec:1, decKg:1, better:'flat', color:'var(--m-os)',     min:0.5, max:20, minKg:0.5,maxKg:25,  opaque:true, group:'compo'},
  protein: {key:'protein',label:'Protéines',          short:'Prot.',  icon:'egg',  kind:'comp',   defUnit:'pct', dec:1, decKg:2, better:'up',   color:'#39D3A0',         min:5,   max:35, minKg:2,  maxKg:60,  group:'compo'},
  kcalOut: {key:'kcalOut',label:'Dépense (balance)',  short:'Dépense',icon:'battery',  kind:'scalar', unit:'kcal', dec:0, better:'flat', color:'var(--m-cal)',    min:800, max:8000},
  kcalIn : {key:'kcalIn', label:'Calories mangées',   short:'Mangé',  icon:'plate',  kind:'scalar', unit:'kcal', dec:0, better:'flat', color:'#F0A93B',         min:0,   max:10000, module:'kcalIn'},
  protIn : {key:'protIn', label:'Protéines mangées',  short:'Protéines',icon:'meat',  kind:'scalar', unit:'g',    dec:0, better:'up',   color:'#39D3A0',         min:0,   max:500},
  visceral:{key:'visceral',label:'Graisse viscérale', short:'Viscé.', icon:'target',  kind:'scalar', unit:'',     dec:0, better:'down', color:'#FB7185',         min:1,   max:60},
  bmr    : {key:'bmr',    label:'Métabolisme de base',short:'MB',     icon:'bolt',  kind:'scalar', unit:'kcal', dec:0, better:'up',   color:'#8AB4F8',         min:800, max:4000},
  metaAge: {key:'metaAge',label:'Âge métabolique',    short:'Âge mét.',icon:'hourglass', kind:'scalar', unit:'ans',  dec:0, better:'down', color:'#A7B2C4',         min:10,  max:99},
  waist  : {key:'waist',  label:'Tour de taille',     short:'Taille', icon:'ruler',  kind:'scalar', unit:'cm',   dec:1, better:'down', color:'#F2789B',         min:40,  max:200},
  hips   : {key:'hips',   label:'Tour de hanches',    short:'Hanches',icon:'ruler',  kind:'scalar', unit:'cm',   dec:1, better:'down', color:'#D8A0F0',         min:40,  max:200},
  chest  : {key:'chest',  label:'Tour de poitrine',   short:'Poitr.', icon:'ruler',  kind:'scalar', unit:'cm',   dec:1, better:'flat', color:'#7FD7FF',         min:40,  max:200},
  arm    : {key:'arm',    label:'Tour de bras',       short:'Bras',   icon:'ruler',  kind:'scalar', unit:'cm',   dec:1, better:'up',   color:'#9AE6B4',         min:15,  max:80},
  thigh  : {key:'thigh',  label:'Tour de cuisse',     short:'Cuisse', icon:'ruler',  kind:'scalar', unit:'cm',   dec:1, better:'up',   color:'#B7E4C7',         min:25,  max:100},
  neck   : {key:'neck',   label:'Tour de cou',        short:'Cou',    icon:'ruler',  kind:'scalar', unit:'cm',   dec:1, better:'down', color:'#C3B0FF',         min:20,  max:70},
  steps  : {key:'steps',  label:'Pas',                short:'Pas',    icon:'steps',  kind:'scalar', unit:'pas',  dec:0, better:'up',   color:'#38BDF8',         min:0,   max:100000},
  sleep  : {key:'sleep',  label:'Sommeil',            short:'Sommeil',icon:'moon',  kind:'scalar', unit:'h',    dec:1, better:'up',   color:'#9A7BFF',         min:0,   max:16},
  mood   : {key:'mood',   label:'Forme du jour',      short:'Forme',  icon:'heart',  kind:'scalar', unit:'/5',   dec:0, better:'up',   color:'#F5C56B',         min:1,   max:5},
  /* Dérivées — jamais saisies */
  bmi    : {key:'bmi',    label:'IMC',                short:'IMC',    icon:'gauge',  kind:'derived',unit:'',     dec:1, better:'down', color:'var(--m-imc)'},
  lean   : {key:'lean',   label:'Masse maigre',       short:'Maigre', icon:'layers',  kind:'derived',unit:'kg',   dec:1, better:'up',   color:'var(--m-maigre)'},
  sport  : {key:'sport',  label:'Sport',              short:'Sport',  icon:'run',  kind:'derived',unit:'min',  dec:0, better:'up',   color:'var(--m-sport)', module:'sport'}
};
/* Ordre d'affichage à la saisie et dans le tableau. */
const METRIC_ORDER=['weight','fat','water','muscle','bone','protein','kcalOut','kcalIn','protIn','visceral','bmr','metaAge',
  'waist','hips','chest','arm','thigh','neck','steps','sleep','mood'];
const COMP_KEYS=METRIC_ORDER.filter(k=>METRICS[k].kind==='comp');

function metricOn(k){
  const m=METRICS[k]; if(!m) return false;
  if(m.always) return true;
  if(m.module) return !!state.settings.modules[m.module];
  return state.settings.metrics[k]!==false;
}
/* Métriques actives à la saisie, dans l'ordre. */
function activeMetrics(){ return METRIC_ORDER.filter(metricOn); }
function metricLabel(k){ return (METRICS[k]||{}).label||k; }
function metricColor(k){ return (METRICS[k]||{}).color||'var(--acc)'; }
function metricIcon(k){ return (METRICS[k]||{}).icon||'gauge'; }
/* La pastille d'une mesure : l'icône, teintée de la couleur de la mesure. */
function metricTile(k,cls){ return '<div class="'+(cls||'row-ic')+'" style="color:'+metricColor(k)+'">'+ic(metricIcon(k))+'</div>'; }

/* ============================================================
   PESÉES : accès, conversions % ↔ kg, dérivées
   ------------------------------------------------------------
   RÈGLE FONDATRICE : on stocke UNIQUEMENT la valeur saisie et
   son unité — `entry.m.fat = {v:32.4, u:'pct'}` — jamais les
   deux unités. L'autre unité est recalculée à la volée à partir
   du poids du jour. Si le poids est corrigé après coup, tous les
   kilos dérivés se corrigent tout seuls. Une métrique non saisie
   n'a PAS de clé (0 est une vraie valeur pour les calories).
   ============================================================ */
function defaultUnitOf(k){ const m=METRICS[k]||{}; return m.kind==='comp' ? (m.defUnit||'pct') : (m.unit||''); }
function isDualKey(k){ return (METRICS[k]||{}).kind==='comp'; }

/* Conversion sans arrondi : l'arrondi n'a lieu qu'à l'affichage. */
function convertMetric(v,fromU,toU,wKg){
  if(v==null||!isFinite(v)) return null;
  if(fromU===toU) return v;
  if(wKg==null||!(wKg>0)) return null;
  if(fromU==='pct'&&toU==='kg') return wKg*v/100;
  if(fromU==='kg'&&toU==='pct') return v/wKg*100;
  return null;
}

function entriesAll(){ return state.entries; }
function entryFor(date){ const a=state.entries; for(let i=a.length-1;i>=0;i--) if(a[i].date===date) return a[i]; return null; }
function lastEntry(){ return state.entries.length?state.entries[state.entries.length-1]:null; }
function firstEntry(){ return state.entries.length?state.entries[0]:null; }
function makeEntry(date){ const now=new Date().toISOString();
  return {id:uid(), date:date, m:{}, note:null, tags:[], source:'manual', createdAt:now, updatedAt:now}; }
/* Insère à la bonne place pour garder state.entries trié par date. */
function ensureEntry(date){
  let e=entryFor(date); if(e) return e;
  e=makeEntry(date);
  let i=state.entries.length; while(i>0 && state.entries[i-1].date>date) i--;
  state.entries.splice(i,0,e);
  return e;
}
function deleteEntry(date){ const i=state.entries.findIndex(x=>x.date===date); if(i<0) return null;
  return state.entries.splice(i,1)[0]; }
function entryIsEmpty(e){
  if(!e) return true;
  for(const k in e.m){ if(e.m[k]&&e.m[k].v!=null) return false; }
  if(e.tags&&e.tags.length) return false;
  return !(e.note&&String(e.note).trim());
}

/* Écriture : `value` est exprimée dans `unit`. null efface la métrique. */
function setMetric(e,k,value,unit){
  if(!e.m) e.m={};
  if(value==null||!isFinite(value)){ delete e.m[k]; e.updatedAt=new Date().toISOString(); return; }
  e.m[k]={v:value,u:unit||defaultUnitOf(k)};
  e.updatedAt=new Date().toISOString();
}
function delMetric(e,k){ if(e.m) delete e.m[k]; }
function rawMetric(e,k){ const x=e&&e.m&&e.m[k]; return (x&&x.v!=null)?x:null; }
function hasMetric(e,k){ return !!rawMetric(e,k); }

/* Poids pivot d'une pesée : celui du jour, sinon (option) le plus proche à ±N jours. */
function pivotWeightKg(entry,opt){
  opt=opt||{};
  const own=entry&&entry.m&&entry.m.weight;
  if(own&&own.v!=null) return {kg:own.v,exact:true,date:entry.date};
  if(opt.noFallback||state.settings.convertFallback!=='lastKnown') return null;
  const win=state.settings.convertFallbackDays||7;
  let best=null;
  for(const e of state.entries){
    const w=e.m&&e.m.weight; if(!w||w.v==null) continue;
    const d=Math.abs(diffDays(e.date,entry.date));
    if(d>win) continue;
    const past=e.date<=entry.date;
    if(!best||d<best.d||(d===best.d&&past&&!best.past)) best={d:d,past:past,e:e};
  }
  return best?{kg:best.e.m.weight.v,exact:false,date:best.e.date}:null;
}

/* LECTURE UNIVERSELLE. Renvoie {value, exact, basisDate} ou null. */
function metricValue(e,k,unit){
  if(!e) return null;
  const M=METRICS[k]; if(!M) return null;
  if(M.kind==='derived'){
    if(k==='bmi'){ const w=mv(e,'weight'); const b=bmiOf(w); return b==null?null:{value:b,exact:true}; }
    if(k==='lean'){
      const w=mv(e,'weight'), f=metricValue(e,'fat','kg');
      if(w==null||!f) return null;
      const v=(unit==='pct')?(w-f.value)/w*100:(w-f.value);
      return {value:v,exact:f.exact,basisDate:f.basisDate};
    }
    if(k==='sport'){ const s=eSportMin(e.date); return s==null?null:{value:s,exact:true}; }
    return null;
  }
  const raw=rawMetric(e,k); if(!raw) return null;
  const want=unit||raw.u;
  if(want===raw.u) return {value:raw.v,exact:true};
  if(!isDualKey(k)) return {value:raw.v,exact:true};       // scalaire : pas de conversion
  const piv=pivotWeightKg(e);
  if(!piv) return null;
  const v=convertMetric(raw.v,raw.u,want,piv.kg);
  return v==null?null:{value:v,exact:piv.exact,basisDate:piv.exact?null:piv.date};
}
/* Raccourci : la valeur seule (null si indisponible). */
function mv(e,k,unit){ const r=metricValue(e,k,unit); return r?r.value:null; }
/* Valeur seule mais EXACTE uniquement (jamais estimée) — pour les agrégats et les tendances. */
function mvExact(e,k,unit){ const r=metricValue(e,k,unit); return (r&&r.exact)?r.value:null; }

function bmiOf(kg){ const h=(state.settings.profile.heightCm||0)/100; return (kg==null||!h)?null:kg/(h*h); }
function weightForBmi(b){ const h=(state.settings.profile.heightCm||0)/100; return h?b*h*h:null; }
function eSportMin(date){ if(!state.settings.modules.sport) return null;
  let s=0,found=false; (state.sessions||[]).forEach(x=>{ if(x.date===date){ s+=(x.durationMin||0); found=true; } });
  return found?s:null; }

/* Unité d'affichage préférée d'une métrique. */
function metricUnit(k){
  const m=METRICS[k]; if(!m) return '';
  if(m.kind==='comp'||k==='lean'){ const p=state.settings.metricUnitPref||{}; return p[k]||m.defUnit||'pct'; }
  return m.unit||'';
}
function unitLabel(k,unit){ const m=METRICS[k]||{};
  if(m.kind==='comp'||k==='lean') return unit==='kg'?'kg':'%';
  return m.unit||''; }
function metricDec(k,unit){ const m=METRICS[k]||{};
  if((m.kind==='comp'||k==='lean')&&unit==='kg') return m.decKg==null?1:m.decKg;
  return m.dec==null?1:m.dec; }
function fmtMetric(v,k,unit){
  if(v==null) return '—';
  const u=unitLabel(k,unit);
  return nf(v,metricDec(k,unit))+(u?NBSP+u:'');
}
/* Bornes de plausibilité (avertissement doux, jamais de blocage). */
function metricRange(k,unit){
  const m=METRICS[k]||{};
  if((m.kind==='comp')&&unit==='kg') return {min:m.minKg==null?0.2:m.minKg, max:m.maxKg==null?200:m.maxKg};
  return {min:m.min, max:m.max};
}

/* ============================================================
   MOTEUR DE CALCUL ET D'ANALYSE
   ------------------------------------------------------------
   Aucune fonction d'ici ne touche au DOM. Tout est dérivé,
   rien n'est stocké. Deux lissages cohabitent, chacun à sa place :
   - une EMA à pas adaptatif  → LA courbe de tendance affichée
     (toujours définie, même avec des trous) ;
   - une régression robuste (Theil–Sen) sur les pesées BRUTES
     → le rythme kg/semaine, l'ETA et la détection de palier
     (régresser sur une série lissée fabriquerait de fausses
     certitudes).
   ============================================================ */
let CACHE={};
function invalidateCache(){ CACHE={}; }
function cached(key,fn){ if(CACHE[key]===undefined) CACHE[key]=fn(); return CACHE[key]; }

/* ---------- Séries ---------- */
function weighIns(){ return cached('weighIns',()=>state.entries.filter(e=>mv(e,'weight')!=null)); }
function seriesOf(pick,tag){
  const build=()=>{ const out=[];
    for(const e of state.entries){ const v=pick(e); if(v!=null&&isFinite(v)) out.push({d:e.date,t:dayNum(e.date),v:v}); }
    return out; };
  return tag?cached('S:'+tag,build):build();
}
const PICK_W    = e=>mv(e,'weight');
const PICK_FATK = e=>mvExact(e,'fat','kg');
const PICK_FATP = e=>mv(e,'fat','pct');
const PICK_MUSK = e=>mvExact(e,'muscle','kg');
const PICK_WATP = e=>mv(e,'water','pct');
const PICK_LEAN = e=>{ const w=mv(e,'weight'),f=mvExact(e,'fat','kg'); return (w==null||f==null)?null:w-f; };
const PICK_KIN  = e=>mv(e,'kcalIn');
function serieW(){ return seriesOf(PICK_W,'w'); }
function windowOf(serie,today,days){ const t1=dayNum(today||isoToday()), t0=t1-days+1;
  return serie.filter(p=>p.t>=t0&&p.t<=t1); }
function coverage(days){ const t=isoToday(); return windowOf(serieW(),t,days).length/days; }
function daysTracked(){ const f=firstEntry(); return f?diffDays(f.date,isoToday())+1:0; }

/* ---------- Statistiques de base ---------- */
function median(a){ const n=a.length; if(!n) return null; const s=a.slice().sort((x,y)=>x-y), m=n>>1;
  return n%2?s[m]:(s[m-1]+s[m])/2; }
function meanOf(a){ return a.length?a.reduce((s,x)=>s+x,0)/a.length:null; }
function sdOf(a){ const n=a.length; if(n<2) return null; const m=meanOf(a);
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(n-1)); }
const TTAB=[0,12.71,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,
  2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];
function tCrit(df){ if(df<1) return 12.71; if(df<=30) return TTAB[df]; return df<=60?2.00:1.96; }
const CI_INFLATE=1.30;   // les pesées quotidiennes sont autocorrélées : on élargit volontairement
function linreg(pts){
  const n=pts.length; if(n<3) return null;
  let sx=0,sy=0; for(const p of pts){ sx+=p.t; sy+=p.v; }
  const mx=sx/n,my=sy/n; let sxx=0,sxy=0;
  for(const p of pts){ const dx=p.t-mx; sxx+=dx*dx; sxy+=dx*(p.v-my); }
  if(sxx<1e-9) return null;
  const b=sxy/sxx, a=my-b*mx;
  let ss=0,st=0; for(const p of pts){ const f=a+b*p.t; ss+=(p.v-f)*(p.v-f); st+=(p.v-my)*(p.v-my); }
  const df=n-2, se=df>0?Math.sqrt((ss/df)/sxx):null, half=se!=null?tCrit(df)*se*CI_INFLATE:null;
  return {n:n,a:a,b:b,r2:st>1e-9?1-ss/st:0,se:se,sigma:df>0?Math.sqrt(ss/df):null,
    ciLo:half!=null?b-half:null, ciHi:half!=null?b+half:null};
}
function theilSen(pts){
  const n=pts.length; if(n<4) return null;
  let step=1; if(n*(n-1)/2>4000) step=Math.ceil(n/Math.sqrt(8000));
  const sl=[];
  for(let i=0;i<n;i+=step) for(let j=i+1;j<n;j+=step){
    const dx=pts[j].t-pts[i].t; if(dx<3) continue; sl.push((pts[j].v-pts[i].v)/dx); }
  return sl.length<6?null:median(sl);
}
function pearson(xs,ys){
  const n=xs.length; if(n<4) return null;
  let sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for(let i=0;i<n;i++){ const x=xs[i],y=ys[i]; sx+=x; sy+=y; sxx+=x*x; syy+=y*y; sxy+=x*y; }
  const dx=n*sxx-sx*sx, dy=n*syy-sy*sy;
  return (dx<1e-9||dy<1e-9)?null:(n*sxy-sx*sy)/Math.sqrt(dx*dy);
}
function slopeOf(xs,ys){
  const n=xs.length; let sx=0,sy=0,sxx=0,sxy=0;
  for(let i=0;i<n;i++){ sx+=xs[i]; sy+=ys[i]; sxx+=xs[i]*xs[i]; sxy+=xs[i]*ys[i]; }
  const d=n*sxx-sx*sx; return d<1e-9?null:(n*sxy-sx*sy)/d;
}
const RCRIT=[[10,0.632],[15,0.514],[20,0.444],[25,0.396],[30,0.361],[40,0.312],[50,0.279],[60,0.254],
  [80,0.220],[100,0.197],[150,0.160],[200,0.139]];
function rCrit(n){ if(n<=10) return 0.632; if(n>=200) return 0.139;
  for(let i=0;i<RCRIT.length-1;i++){ const a=RCRIT[i],b=RCRIT[i+1];
    if(n>=a[0]&&n<=b[0]) return a[1]+(b[1]-a[1])*(n-a[0])/(b[0]-a[0]); }
  return 0.20; }

/* ---------- Tendance affichée : EMA à pas adaptatif ----------
   Un trou de 3 jours compte comme trois pas d'un coup : la tendance
   reste définie dès la première pesée, sans jamais inventer de valeur. */
const TREND_ALPHA=0.25, TREND_ALPHA_MAX=0.90;
function trendSeries(){
  return cached('trend',()=>{
    const l=weighIns(), out=[]; let ema=null, prev=null;
    for(const e of l){
      const w=mv(e,'weight');
      if(ema==null) ema=w;
      else{ const gap=Math.max(1,diffDays(prev,e.date));
        const a=Math.min(TREND_ALPHA_MAX,1-Math.pow(1-TREND_ALPHA,gap));
        ema=ema+a*(w-ema); }
      prev=e.date;
      out.push({date:e.date,raw:w,trend:Math.round(ema*1000)/1000});
    }
    return out;
  });
}
function trendNow(){ const s=trendSeries(); return s.length?s[s.length-1].trend:null; }
function trendAt(d){ const s=trendSeries(); let v=null;
  for(let i=0;i<s.length;i++){ if(s[i].date<=d) v=s[i].trend; else break; } return v; }
/* Poids de référence affiché partout, avec son libellé honnête. */
function refWeight(){
  const t=trendNow(), l=weighIns();
  if(t==null) return {kg:null,mode:'none',label:'aucune pesée'};
  const last=l[l.length-1];
  const age=diffDays(last.date,isoToday());
  if(l.length<3) return {kg:mv(last,'weight'),mode:'raw',label:'dernière pesée du '+fmtDateShort(last.date),age:age};
  return {kg:t,mode:'ema',label:'tendance lissée',age:age};
}

/* ---------- Rythme, palier ---------- */
const TREND_WINDOWS=[28,21,14], TREND_MIN_PTS=8, TREND_MIN_SPAN=10;
function trendRate(days){
  const S=serieW(), wins=days?[days]:TREND_WINDOWS, today=isoToday();
  for(const w of wins){
    const pts=windowOf(S,today,w);
    if(pts.length<TREND_MIN_PTS) continue;
    if((pts[pts.length-1].t-pts[0].t)<TREND_MIN_SPAN) continue;
    const ols=linreg(pts), rob=theilSen(pts);
    const b=rob!=null?rob:(ols?ols.b:null);
    if(b==null) continue;
    return {ok:true,window:w,n:pts.length,kgDay:b,kgWeek:b*7,
      olsKgWeek:ols?ols.b*7:null,
      ciLoKgWeek:(ols&&ols.ciLo!=null)?ols.ciLo*7:null,
      ciHiKgWeek:(ols&&ols.ciHi!=null)?ols.ciHi*7:null,
      r2:ols?ols.r2:null, sigma:ols?ols.sigma:null,
      significant:!!(ols&&ols.ciLo!=null&&ols.ciLo*ols.ciHi>0)};
  }
  return {ok:false,reason:'pas assez de pesées',need:TREND_MIN_PTS};
}
function rateSinceStart(){
  const s=startDate(), t=trendNow(), w0=startWeight();
  if(s==null||t==null||w0==null) return null;
  const d=diffDays(s,isoToday()); if(d<7) return null;
  return Math.round(((t-w0)/d*7)*1000)/1000;
}
/* Rythme retenu : robuste sur 28 j, pondéré par la moyenne longue quand l'historique le permet. */
function bestRate(){
  return cached('rate',()=>{
    const t=trendRate();
    const since=rateSinceStart();
    if(!t.ok) return since;
    if(since!=null&&daysTracked()>=56) return Math.round((0.6*t.kgWeek+0.4*since)*1000)/1000;
    return Math.round(t.kgWeek*1000)/1000;
  });
}
const PLATEAU_WIN=21, PLATEAU_MIN_PTS=10, PLATEAU_SLOPE=0.15;
function detectPlateau(){
  const S=serieW(), today=isoToday();
  const pts=windowOf(S,today,PLATEAU_WIN);
  if(pts.length<PLATEAU_MIN_PTS) return {isPlateau:false,reason:'peu de données'};
  const ols=linreg(pts), rob=theilSen(pts); if(!ols) return {isPlateau:false};
  const kgWeek=(rob!=null?rob:ols.b)*7;
  const flat=Math.abs(kgWeek)<=PLATEAU_SLOPE;
  const ciCross=ols.ciLo!=null&&ols.ciLo<=0&&ols.ciHi>=0;
  if(!(flat&&ciCross)) return {isPlateau:false,kgWeek:kgWeek};
  let since=PLATEAU_WIN;
  for(let k=PLATEAU_WIN+1;k<=120;k++){
    const p2=windowOf(S,today,k); if(p2.length<PLATEAU_MIN_PTS) break;
    const o2=linreg(p2), r2s=theilSen(p2); if(!o2) break;
    if(Math.abs((r2s!=null?r2s:o2.b)*7)>PLATEAU_SLOPE) break;
    since=k;
  }
  return {isPlateau:true,sinceDays:since,kgWeek:kgWeek};
}

/* ---------- Départ, objectif, ETA ---------- */
function firstWeighIn(){ const l=weighIns(); return l.length?l[0]:null; }
function lastWeighIn(){ const l=weighIns(); return l.length?l[l.length-1]:null; }
function startDate(){ const o=state.settings.startOverride; if(o&&o.date) return o.date;
  const f=firstWeighIn(); return f?f.date:null; }
/* Poids de départ robuste : moyenne des 7 premiers jours mesurés (une seule pesée bruitée ne fixe pas le cap). */
function startWeight(){
  const o=state.settings.startOverride; if(o&&o.weightKg!=null) return o.weightKg;
  const S=serieW(); if(!S.length) return null;
  const t0=S[0].t, w=S.filter(p=>p.t<=t0+6).map(p=>p.v);
  return Math.round(meanOf(w)*100)/100;
}
function targetWeight(){ const g=state.settings.goal; return (g&&g.weightKg!=null)?g.weightKg:null; }
function sinceStartDays(){ const s=startDate(); return s?Math.max(0,diffDays(s,isoToday())):null; }
function kgLost(){ const w0=startWeight(), t=trendNow(); return (w0==null||t==null)?null:Math.round((w0-t)*100)/100; }
function kgLeft(){ const tg=targetWeight(), t=trendNow(); return (tg==null||t==null)?null:Math.max(0,Math.round((t-tg)*100)/100); }
function goalProgressPct(){
  const w0=startWeight(), tg=targetWeight(), t=trendNow();
  if(w0==null||tg==null||t==null||Math.abs(tg-w0)<0.05) return null;
  return clamp((t-w0)/(tg-w0),0,1);
}
const ETA_MAX_DAYS=730;
function etaDaysRaw(){
  const rest=kgLeft(); if(rest==null) return null;
  if(rest<=0.05) return 0;
  if(daysTracked()<14) return null;
  const r=bestRate();
  if(r==null||r>=-0.05) return null;
  const d=Math.ceil(rest/(-r/7));
  return d>ETA_MAX_DAYS?null:d;
}
/* La date estimée est GELÉE tant qu'aucune nouvelle pesée n'arrive : une date qui
   saute à chaque re-rendu détruit la confiance qu'on lui accorde. */
function etaDays(){
  const key=isoToday()+'|'+weighIns().length+'|'+(targetWeight()==null?'-':targetWeight());
  const s=state.ui.etaShown;
  if(s&&s.key===key) return s.days;
  const d=etaDaysRaw();
  state.ui.etaShown={key:key,days:d};
  return d;
}
function etaDate(){ const d=etaDays(); return d==null?null:addDayYMD(isoToday(),d); }
function humanDuration(d){
  if(d==null) return '—';
  if(d<14) return d+(d>1?' jours':' jour');
  if(d<70) return Math.round(d/7)+' semaines';
  const m=Math.round(d/30.44); if(m<24) return m+' mois';
  return nf(d/365.25,1)+' ans';
}
function rateWord(r){
  if(r==null) return 'trop tôt';
  const a=Math.abs(r);
  if(r>=0.05) return 'ça remonte un peu';
  if(a<0.1) return 'palier';
  if(a<0.35) return 'doux et durable';
  if(a<0.8) return 'bon rythme';
  if(a<1.2) return 'rythme soutenu';
  return 'très rapide';
}

/* ---------- IMC ---------- */
const BMI_CATS=[[18.5,'Maigreur'],[25,'Corpulence normale'],[30,'Surpoids'],
  [35,'Obésité modérée'],[40,'Obésité sévère'],[999,'Obésité massive']];
function bmiCat(v){ if(v==null) return '—'; for(const c of BMI_CATS) if(v<c[0]) return c[1]; return '—'; }
function nextBmiThreshold(nowKg){
  const b=bmiOf(nowKg); if(b==null) return null;
  const downs=[35,30,27,25,18.5].filter(x=>x<b);
  if(!downs.length) return null;
  const nb=downs[0], target=weightForBmi(nb);
  return {bmi:nb,kg:target,remainKg:nowKg-target};
}

/* ---------- Composition ---------- */
/* Comparaison entre deux dates, toujours sur la valeur lissée localement.
   La masse grasse d'une balance à impédance bouge de ±1 à 2 points d'un jour à l'autre :
   interdiction d'interpréter une variation sur moins de 14 jours. */
const COMP_MIN_DAYS=14, COMP_MIN_PTS=6;
function maCentered(S,tDay,half,minPts){
  half=half==null?3:half; minPts=minPts==null?2:minPts;
  const t0=tDay-half, t1=tDay+half;
  let s=0,n=0,mn=Infinity,mx=-Infinity;
  for(const p of S){ if(p.t<t0) continue; if(p.t>t1) break; s+=p.v; n++; if(p.t<mn) mn=p.t; if(p.t>mx) mx=p.t; }
  if(n<minPts) return null;
  return s/n;
}
function compDelta(pick,days){
  const S=seriesOf(pick);
  if(days<COMP_MIN_DAYS) return {ok:false,reason:'fenêtre trop courte'};
  const t1=dayNum(isoToday()), t0=t1-days+1;
  const v1=maCentered(S,t1,4), v0=maCentered(S,t0,4);
  const n=windowOf(S,isoToday(),days).length;
  if(v0==null||v1==null||n<COMP_MIN_PTS) return {ok:false,reason:'pas assez de mesures',n:n};
  return {ok:true,from:v0,to:v1,delta:v1-v0,n:n,days:days};
}
/* Variation depuis le tout début (utilisée par les tuiles de l'accueil). */
function totalDelta(pick){
  const S=seriesOf(pick);
  if(S.length<2) return null;
  const a=S[0].v, b=S[S.length-1].v;
  return {from:a,to:b,delta:Math.round((b-a)*100)/100,n:S.length,lastDate:S[S.length-1].d};
}
const SEUIL_W=0.60, SEUIL_F=0.50;
function interpretComposition(dW,dF,dP){
  const negW=dW<-SEUIL_W, posW=dW>SEUIL_W, flatW=Math.abs(dW)<=SEUIL_W;
  const negF=dF<-SEUIL_F, posF=dF>SEUIL_F, flatF=Math.abs(dF)<=SEUIL_F;
  const dL=dW-dF;
  if(negW&&negF) return {code:'gras_perdu',tone:'pos',
    text:'Tu as vraiment perdu du gras : '+sgnKg(dF)+' de masse grasse, et '+sgnKg(dL)+' de masse maigre. C’est ce qu’on veut voir.'};
  if(negW&&flatF) return {code:'poids_sans_gras',tone:'warn',
    text:'Ton pourcentage de graisse a baissé ('+sgnPt(dP)+'), mais en kilos ta masse grasse n’a quasiment pas bougé ('+sgnKg(dF)+'). Ce que tu as perdu, c’est surtout de l’eau et de la masse maigre : le pourcentage baisse parce que le poids baisse, pas parce que le gras part.'};
  if(negW&&posF) return {code:'incoherent',tone:'warn',
    text:'Poids en baisse mais masse grasse en hausse d’après la balance : mesure peu fiable sur cette période (hydratation, heure de pesée). À reprendre dans deux semaines.'};
  if(flatW&&negF) return {code:'recomposition',tone:'pos',
    text:'Même poids, mais '+sgnKg(dF)+' de masse grasse et '+sgnKg(dL)+' de masse maigre : c’est une recomposition. La balance ne le montre pas, tes mesures si.'};
  if(posW&&negF) return {code:'prise_maigre',tone:'pos',
    text:'Tu as pris '+sgnKg(dW)+', dont '+sgnKg(dF)+' de gras : la prise est surtout de la masse maigre.'};
  if(posW&&posF) return {code:'prise_gras',tone:'neutral',
    text:'Sur cette période, '+sgnKg(dW)+' au total dont '+sgnKg(dF)+' de masse grasse.'};
  return {code:'stable',tone:'neutral',
    text:'Rien de significatif sur cette période : les écarts restent dans la marge d’erreur de la balance.'};
}
function lossQuality(days){
  days=days||28;
  const w=compDelta(PICK_W,days), f=compDelta(PICK_FATK,days);
  if(!w.ok||!f.ok) return {ok:false,reason:w.ok?f.reason:w.reason};
  if(w.delta>=-SEUIL_W) return {ok:false,reason:'pas de perte nette'};
  const ratio=clamp(f.delta/w.delta,0,1.2);
  let label,tone;
  if(ratio>=0.75){ label='excellente'; tone='pos'; }
  else if(ratio>=0.50){ label='bonne'; tone='pos'; }
  else if(ratio>=0.25){ label='moyenne'; tone='neutral'; }
  else { label='faible'; tone='warn'; }
  return {ok:true,ratio:ratio,pct:Math.round(ratio*100),label:label,tone:tone,
    lossKg:-w.delta,fatKg:-f.delta,leanKg:-(w.delta-f.delta),days:days};
}

/* ---------- Bilan énergétique ---------- */
const KCAL_PER_KG_FAT=7700;
function profileAge(){ const y=state.settings.profile.birthYear;
  return y?Math.max(10,new Date().getFullYear()-y):27; }
function bmrMifflin(kg,cm,age,sex){
  if(kg==null||!cm) return null;
  return 10*kg+6.25*cm-5*(age||27)+((sex==='f')?-161:5);
}
const PAL=[
  {code:'sed',f:1.20, label:'Sédentaire',        hint:'bureau, peu de marche'},
  {code:'leg',f:1.375,label:'Légèrement actif',  hint:'1 à 2 séances par semaine'},
  {code:'mod',f:1.55, label:'Modérément actif',  hint:'3 à 4 séances par semaine'},
  {code:'act',f:1.725,label:'Très actif',        hint:'5 à 6 séances par semaine'},
  {code:'ext',f:1.90, label:'Extrêmement actif', hint:'métier physique + sport quotidien'}];
function palOf(code){ return PAL.find(x=>x.code===code)||PAL[1]; }
/* Le métier pèse plus lourd que le sport dans une journée : huit heures debout brûlent
   davantage que trois séances par semaine. C'est la base (NEAT) sur laquelle on ajoute
   les séances, au lieu de tout déduire du seul sport. */
const JOBS=[
  {code:'bureau',  f:1.20, icon:'chair',    label:'Bureau, assis',      hint:'ordinateur, peu de marche'},
  {code:'mixte',   f:1.30, icon:'walk',     label:'Assis et debout',    hint:'bureau + déplacements'},
  {code:'debout',  f:1.40, icon:'briefcase',label:'Debout la journée',  hint:'commerce, atelier, enseignement'},
  {code:'marche',  f:1.50, icon:'run',      label:'Beaucoup de marche', hint:'soignant, serveur, livraison'},
  {code:'physique',f:1.62, icon:'bricks',   label:'Métier physique',    hint:'BTP, manutention, charges lourdes'}];
function jobOf(code){ return JOBS.find(x=>x.code===code)||JOBS[0]; }
function currentJob(){ return jobOf(state.settings.profile.job||'bureau'); }
function autoPal(sessPerWeek){
  if(sessPerWeek<1) return 'sed';
  if(sessPerWeek<2.5) return 'leg';
  if(sessPerWeek<4.5) return 'mod';
  if(sessPerWeek<6) return 'act';
  return 'ext';
}
function sessionsPerWeek(days){
  if(!state.settings.modules.sport) return 0;   // sans le module, Élan ne sait rien de tes séances
  days=days||28; const from=addDayYMD(isoToday(),-(days-1));
  const n=(state.sessions||[]).filter(s=>s.date>=from).length;
  return n/(days/7);
}
/* Calories de sport lissées sur la journée. On les recalcule toujours par le MET :
   l'utilisateur peut avoir masqué l'affichage des kcal, ça ne change pas sa dépense. */
function sportKcalPerDay(days){
  if(!state.settings.modules.sport) return 0;
  days=days||28; const from=addDayYMD(isoToday(),-(days-1));
  let tot=0;
  (state.sessions||[]).forEach(s=>{ if(s.date<from) return;
    tot+=(s.kcalSource==='manual'&&s.kcal!=null)?s.kcal:estimateKcal(s.activityKey,s.durationMin,s.intensity,s.date).kcal; });
  return tot/days;
}
function currentPal(){
  const s=state.settings.energy;
  /* En automatique sans module Sport, on ne peut rien déduire : on retombe sur le réglage manuel. */
  if(s.palMode==='auto'&&state.settings.modules.sport) return autoPal(sessionsPerWeek(28));
  return s.pal||'leg';
}
/* Facteur d'activité détaillé : base du métier + apport réel des séances.
   En mode manuel, on respecte le choix de l'utilisateur sans rien y ajouter. */
function activityFactor(kg){
  const s=state.settings.energy;
  const bmr=bmrMifflin(kg!=null?kg:refWeight().kg,state.settings.profile.heightCm,profileAge(),state.settings.profile.sex);
  if(s.palMode!=='auto'){ const p=palOf(s.pal||'leg');
    return {f:p.f,base:p.f,sport:0,bmr:bmr,job:null,manual:true,label:p.label}; }
  const job=currentJob();
  const sport=(bmr&&bmr>0)?Math.min(0.45,sportKcalPerDay(28)/bmr):0;
  const f=Math.round((job.f+sport)*1000)/1000;
  return {f:f,base:job.f,sport:Math.round(sport*1000)/1000,bmr:bmr,job:job,manual:false,
    label:job.label+(sport>=0.02?' + tes séances':'')};
}
function tdeeTheo(){
  const ref=refWeight().kg; if(ref==null) return null;
  const a=activityFactor(ref);
  return a.bmr==null?null:Math.round(a.bmr*a.f);
}
/* Protéines : le seul macro qui change vraiment quelque chose en déficit.
   1,6 g par kilo de poids de FORME (et non de poids actuel : les kilos de graisse
   n'ont pas besoin d'être nourris). On borne pour rester raisonnable. */
const PROT_PER_KG=1.6;
function proteinTarget(){
  const tg=targetWeight(), cur=refWeight().kg;
  if(cur==null) return null;
  /* Poids de référence : l'objectif s'il est crédible, sinon la masse maigre + 15 %,
     sinon le poids actuel plafonné — un homme de 110 kg n'a pas besoin de 176 g. */
  let base=null;
  const e=lastWeighIn(), f=e?metricValue(e,'fat','kg'):null;
  if(f&&f.value!=null&&cur-f.value>20) base=(cur-f.value)*1.20;
  if(tg!=null&&tg<cur) base=base!=null?Math.min(base,tg):tg;
  if(base==null) base=cur*0.85;
  const g=Math.round(clamp(base*PROT_PER_KG,50,260)/5)*5;
  return {g:g,basisKg:Math.round(base),perKg:PROT_PER_KG};
}
function proteinStats(days){
  days=days||14;
  const from=addDayYMD(isoToday(),-(days-1));
  const vals=[]; state.entries.forEach(e=>{ if(e.date<from) return;
    const v=mv(e,'protIn'); if(v!=null) vals.push(v); });
  const t=proteinTarget();
  if(!vals.length||!t) return {ok:false,target:t,n:0};
  const moy=meanOf(vals);
  return {ok:true,target:t,n:vals.length,mean:Math.round(moy),
    hit:vals.filter(v=>v>=t.g*0.9).length,pct:Math.round(Math.min(1.4,moy/t.g)*100)};
}

/* Le point neutre : le nombre de calories où ton poids ne bouge plus.
   On préfère TOUJOURS l'observé (mesuré sur toi) à la formule (moyenne de population). */
function maintenanceKcal(){
  const obs=tdeeObserved();
  if(obs.ok) return {kcal:obs.kcal,source:'observé',solid:!!obs.solid,jeune:!!obs.jeune,
    why:'calculé sur tes '+obs.n+' journées de calories et ta perte réelle'
      +(obs.jeune?', prudemment revu à la baisse : sur un début de suivi, une partie de la perte est de l’eau':'')};
  const th=tdeeTheo();
  if(th==null) return {kcal:null,source:null,solid:false,why:'profil incomplet'};
  const a=activityFactor();
  return {kcal:Math.round(th/10)*10,source:'estimé',solid:false,
    why:'formule Mifflin-St Jeor × '+nf(a.f,2)+(a.job?' ('+a.job.label.toLowerCase()+')':'')};
}
/* Simulation jour par jour. Le métabolisme baisse avec le poids : projeter en ligne
   droite promet des dates qu'on ne tiendra pas. Ici, on recalcule chaque matin. */
function simulate(intakeKcal,opt){
  opt=opt||{};
  const cm=state.settings.profile.heightCm, age=profileAge(), sex=state.settings.profile.sex;
  let w=opt.startKg!=null?opt.startKg:refWeight().kg;
  if(w==null||!cm||intakeKcal==null) return {ok:false};
  const a=activityFactor(w);
  /* Si on connaît le point neutre observé, on cale le facteur dessus : c'est LA réalité
     de cet utilisateur, formule ou pas. */
  let f=a.f;
  const obs=opt.useObserved===false?{ok:false}:tdeeObserved();
  if(obs.ok){ const b0=bmrMifflin(w,cm,age,sex); if(b0>0) f=obs.kcal/b0; }
  const target=opt.targetKg!=null?opt.targetKg:targetWeight();
  const days=opt.days||1825;                     // cinq ans : à -250 kcal/jour, deux ans ne suffisent pas
  const down=target!=null?(target<w):true;
  const series=[{date:isoToday(),v:Math.round(w*100)/100}];
  let hit=null;
  for(let d=1;d<=days;d++){
    const bmr=bmrMifflin(w,cm,age,sex);
    const tdee=bmr*f;
    w+=(intakeKcal-tdee)/KCAL_PER_KG_FAT;
    if(w<35||w>350) break;
    series.push({date:addDayYMD(isoToday(),d),v:Math.round(w*100)/100});   // pas quotidien : aucun trou dans la courbe
    if(hit===null&&target!=null&&(down?w<=target:w>=target)){ hit=d; break; }   // arrivé : on n'extrapole pas au-delà
  }
  const bmr0=bmrMifflin(opt.startKg!=null?opt.startKg:refWeight().kg,cm,age,sex);
  const tdee0=Math.round(bmr0*f);
  const at=n=>{ const dd=addDayYMD(isoToday(),n); let best=series[0];
    series.forEach(p=>{ if(p.date<=dd) best=p; }); return best.v; };
  return {ok:true,f:f,tdee0:tdee0,intake:intakeKcal,gapDay:Math.round(intakeKcal-tdee0),
    kgWeek:Math.round(((intakeKcal-tdee0)/KCAL_PER_KG_FAT)*7*1000)/1000,
    series:series,etaDays:hit,etaDate:hit!=null?addDayYMD(isoToday(),hit):null,
    target:target,w30:at(30),w90:at(90),w180:at(180),w365:at(365),
    endKg:series[series.length-1].v,source:obs.ok?'observé':'estimé'};
}
/* Dépense OBSERVÉE : ce que tu manges + ce que tu perds. Un calcul indirect,
   mais infiniment plus juste que l'estimation d'une balance. */
const TDEE_MIN_DAYS=14, TDEE_SOLID_DAYS=20;
function tdeeObserved(){
  const W=28;
  const K=windowOf(seriesOf(PICK_KIN),isoToday(),W);
  const Wt=windowOf(serieW(),isoToday(),W);
  if(K.length<TDEE_MIN_DAYS||Wt.length<10) return {ok:false,reason:'pas assez de jours renseignés',nK:K.length,nW:Wt.length};
  const t=trendRate(W); if(!t.ok) return {ok:false,reason:'tendance indisponible'};
  const intake=meanOf(K.map(p=>p.v));
  let kcal=intake+KCAL_PER_KG_FAT*(-t.kgDay);
  if(kcal<1200||kcal>6000) return {ok:false,reason:'résultat hors bornes'};
  /* Les trois premières semaines, une bonne part de la perte est de l'eau et du glycogène :
     le calcul indirect surestime alors la dépense. On plafonne à +25 % de la formule
     plutôt que d'annoncer un chiffre flatteur qui sera démenti le mois suivant. */
  const dStart=sinceStartDays();
  const jeune=dStart!=null&&dStart<28;
  const th=tdeeTheo();
  let plafonne=false;
  if(jeune&&th!=null&&kcal>th*1.25){ kcal=th*1.25; plafonne=true; }
  return {ok:true,kcal:Math.round(kcal/50)*50,intake:Math.round(intake),kgWeek:t.kgWeek,
    n:K.length,days:W,solid:K.length>=TDEE_SOLID_DAYS&&!jeune,jeune:jeune,plafonne:plafonne};
}
function energyBalance(){
  const W=28;
  const K=windowOf(seriesOf(PICK_KIN),isoToday(),W);
  if(K.length<20) return {ok:false,reason:'calories peu renseignées',n:K.length};
  const t=trendRate(W); if(!t.ok) return {ok:false,reason:'tendance indisponible'};
  const tdee=tdeeTheo(); if(tdee==null) return {ok:false,reason:'profil incomplet'};
  const intake=meanOf(K.map(p=>p.v));
  const deficit=tdee-intake;
  const expectedKgWeek=-deficit*7/KCAL_PER_KG_FAT;
  const actualKgWeek=t.kgWeek;
  const ratio=expectedKgWeek<-0.05?actualKgWeek/expectedKgWeek:null;
  return {ok:true,tdee:tdee,intake:intake,deficit:deficit,pal:currentPal(),
    expectedKgWeek:expectedKgWeek,actualKgWeek:actualKgWeek,ratio:ratio,n:K.length};
}

/* ---------- Calories mangées → poids, avec décalage ---------- */
const XC_MAX_LAG=5, XC_MIN_N=30, XC_HINT_N=8, XC_SCAN_PENALTY=1.25;
/* Trois niveaux de confiance plutôt qu'un mur : à 8 journées on montre quelque chose
   en le disant fragile, à 30 on l'affirme. Ne rien afficher pendant un mois décourage
   exactement les gens qui viennent de commencer à noter leurs calories. */
function xcTier(x){ if(!x||x.n==null) return 'aucun';
  if(x.n>=XC_MIN_N&&x.r>=x.crit) return 'solide';
  if(x.n>=15) return 'piste';
  return 'ebauche'; }
/* On teste les décalages à partir de 1 : la pesée du matin précède les repas de la
   journée, un décalage 0 comparerait un effet à une cause postérieure. */
function crossCorrIntakeWeight(maxLag){
  maxLag=maxLag||XC_MAX_LAG;
  const byT={}; state.entries.forEach(e=>{ byT[dayNum(e.date)]=e; });
  const res=[];
  for(let lag=1;lag<=maxLag;lag++){
    const xs=[],ys=[];
    state.entries.forEach(e=>{
      const t=dayNum(e.date), prev=byT[t-1], src=byT[t-lag];
      if(!prev||!src) return;
      const w=mv(e,'weight'), wp=mv(prev,'weight'), k=mv(src,'kcalIn');
      if(w==null||wp==null||k==null) return;
      xs.push(k); ys.push(w-wp);
    });
    const r=pearson(xs,ys);
    const beta=(r!=null&&xs.length>2)?slopeOf(xs,ys):null;
    res.push({lag:lag,n:xs.length,r:r,beta:beta,crit:r!=null?rCrit(xs.length)*XC_SCAN_PENALTY:null});
  }
  const valid=res.filter(x=>x.r!=null&&x.n>=XC_HINT_N);
  if(!valid.length) return {ok:false,reason:'pas assez de jours avec calories ET pesées',all:res,
    n:Math.max.apply(null,res.map(x=>x.n).concat([0])),need:XC_HINT_N};
  let best=valid[0]; for(const x of valid) if(x.r>best.r) best=x;
  return {ok:true,best:best,all:res,tier:xcTier(best),solid:best.n>=XC_MIN_N&&best.r>=best.crit};
}

/* ---------- Effet du sport ---------- */
function weeklyStats(nWeeks){
  const S=serieW(), byWeek={};
  (state.sessions||[]).forEach(s=>{ const k=weekKey(s.date);
    if(!byWeek[k]) byWeek[k]={min:0,cnt:0};
    byWeek[k].min+=(s.durationMin||0); byWeek[k].cnt++; });
  const out=[]; let wk=weekKey(addDayYMD(isoToday(),-7*(nWeeks-1)));
  for(let i=0;i<nWeeks;i++){
    const end=addDayYMD(wk,6), prevEnd=addDayYMD(wk,-1);
    const a=maCentered(S,dayNum(prevEnd),4), b=maCentered(S,dayNum(end),4);
    const s=byWeek[wk]||{min:0,cnt:0};
    out.push({week:wk,minutes:s.min,sessions:s.cnt,dw:(a!=null&&b!=null)?b-a:null,
      complete:dayNum(end)<=dayNum(isoToday())});
    wk=addDayYMD(wk,7);
  }
  return out;
}
function sportEffect(){
  const W=weeklyStats(16).filter(w=>w.complete&&w.dw!=null);
  if(W.length<8) return {ok:false,reason:'moins de 8 semaines complètes',n:W.length};
  const A=W.filter(w=>w.sessions>=2), B=W.filter(w=>w.sessions<2);
  if(A.length<3||B.length<3) return {ok:false,reason:'pas assez de semaines dans les deux cas',a:A.length,b:B.length};
  const mA=meanOf(A.map(w=>w.dw)), mB=meanOf(B.map(w=>w.dw));
  const rMin=pearson(W.map(w=>w.minutes),W.map(w=>w.dw));
  return {ok:true,withKg:mA,withoutKg:mB,diff:mA-mB,nA:A.length,nB:B.length,
    rMinutes:rMin,rSolid:rMin!=null&&Math.abs(rMin)>=rCrit(W.length),
    minutesAvg:meanOf(W.map(w=>w.minutes))};
}

/* ---------- Effet jour de la semaine ---------- */
function weekdayEffect(){
  const S=serieW(), buckets=[[],[],[],[],[],[],[]];
  for(const p of S){ const m=maCentered(S,p.t,3,3); if(m==null) continue; buckets[dowOf(p.d)].push(p.v-m); }
  const total=buckets.reduce((s,b)=>s+b.length,0);
  const rows=buckets.map((b,i)=>({dow:i,label:JOURS[i],n:b.length,mean:b.length>=4?meanOf(b):null}));
  const valid=rows.filter(r=>r.mean!=null);
  if(total<28||valid.length<5) return {ok:false,reason:'pas assez de pesées réparties sur la semaine',n:total,rows:rows};
  let hi=valid[0],lo=valid[0];
  for(const r of valid){ if(r.mean>hi.mean) hi=r; if(r.mean<lo.mean) lo=r; }
  const gap=hi.mean-lo.mean;
  return {ok:true,rows:rows,hi:hi,lo:lo,gap:gap,n:total,
    notable:gap>=0.25&&hi.n>=4&&lo.n>=4};
}

/* ---------- Bruit personnel & anomalies ---------- */
function noiseSigma(){
  return cached('sigma',()=>{
    const S=serieW(), res=[];
    for(const p of windowOf(S,isoToday(),60)){ const m=maCentered(S,p.t,3,3); if(m!=null) res.push(p.v-m); }
    if(res.length<15) return {sigma:0.90,n:res.length,estimated:false};
    return {sigma:clamp(sdOf(res),0.30,2.00),n:res.length,estimated:true};
  });
}
function isOutlier(e){
  if(!e) return false;
  const w=mv(e,'weight'); if(w==null) return false;
  const t=trendAt(addDayYMD(e.date,-1));
  return t!=null&&Math.abs(w-t)>=2.5;
}
function classifyDailyChange(){
  const S=serieW(), t=dayNum(isoToday());
  const cur=S.find(p=>p.t===t), prev=S.find(p=>p.t===t-1);
  if(!cur||!prev) return {code:'na'};
  const d=cur.v-prev.v, sg=noiseSigma().sigma;
  if(Math.abs(d)<sg) return {code:'bruit',delta:d,
    text:sgnKg(d)+' depuis hier : c’est dans ton bruit normal (±'+nf(sg,1)+NBSP+'kg), pas un vrai changement.'};
  if(d>=2*sg&&d>=0.70) return waterRetention(d);
  if(d<=-2*sg&&d<=-0.70) return {code:'baisse_forte',delta:d,
    text:sgnKg(d)+' depuis hier — belle baisse, mais un seul jour ne fait pas une tendance. Regarde la ligne lissée.'};
  return {code:'variation',delta:d,text:sgnKg(d)+' depuis hier.'};
}
function highIntakeThreshold(){
  const K=windowOf(seriesOf(PICK_KIN),isoToday(),28);
  return K.length>=10?meanOf(K.map(p=>p.v))+700:3200;
}
function waterRetention(d){
  const t=dayNum(isoToday()), by={}; state.entries.forEach(e=>by[dayNum(e.date)]=e);
  const cur=by[t], prev=by[t-1], j1=by[t-1], j2=by[t-2];
  const reasons=[];
  const wc=cur?mv(cur,'water','pct'):null, wp=prev?mv(prev,'water','pct'):null;
  if(wc!=null&&wp!=null&&(wc-wp)<=-0.40) reasons.push('ton taux d’eau a baissé de '+sgnPt(wc-wp));
  const hi=highIntakeThreshold();
  if(j1&&mv(j1,'kcalIn')!=null&&mv(j1,'kcalIn')>=hi) reasons.push('tu as mangé '+nf(mv(j1,'kcalIn'),0)+' kcal hier');
  else if(j2&&mv(j2,'kcalIn')!=null&&mv(j2,'kcalIn')>=hi) reasons.push('tu as mangé '+nf(mv(j2,'kcalIn'),0)+' kcal avant-hier');
  if(eSportMin(addDayYMD(isoToday(),-1))||eSportMin(addDayYMD(isoToday(),-2))) reasons.push('tu as eu une séance récemment');
  if([0,1,6].indexOf(dowOf(isoToday()))>=0) reasons.push('on est en sortie de week-end');
  const text=reasons.length
    ? sgnKg(d)+' depuis hier, et '+reasons[0]+' : c’est très probablement de l’eau, pas de la graisse. 1 kg de graisse demande 7 700 kcal — impossible en une nuit.'
    : sgnKg(d)+' depuis hier. Un saut d’un jour, c’est presque toujours de l’eau, du sel ou la digestion.';
  return {code:'retention_eau',delta:d,reasons:reasons,text:text};
}
/* Contrôle doux au moment de la saisie : on demande confirmation, on ne bloque jamais. */
function isOutlierInput(kg,date){
  const S=serieW();
  const base=trendAt(addDayYMD(date,-1))||(S.length?S[S.length-1].v:null);
  if(base==null) return {suspect:false};
  const gap=Math.abs(kg-base);
  const sg=noiseSigma().sigma;
  if(gap>Math.max(4*sg,4.0)){
    const rev=parseFloat(String(Math.round(kg*10)/10).replace('.','').split('').reverse().join(''))/10;
    return {suspect:true,base:base,gap:gap,
      text:'Tu as saisi '+nf(kg,1)+NBSP+'kg. Ta référence est '+nf(base,1)+NBSP+'kg — un écart de '+nf(gap,1)+NBSP+'kg. Tu confirmes ?'};
  }
  return {suspect:false};
}

/* ---------- Régularité ---------- */
/* Règle bienveillante : la série tient tant qu'il n'y a pas DEUX jours de suite sans chiffre,
   et le jour en cours ne casse jamais rien (on n'est pas encore « en retard »). */
function streakInfo(){
  const set={}; weighIns().forEach(e=>set[e.date]=1);
  let cur=isoToday(); if(!set[cur]) cur=addDayYMD(cur,-1);
  let days=0,run=0,jokers=0,guard=0;
  while(guard++<3700){
    if(set[cur]){ days++; run=0; }
    else{ run++; if(run>=2){ jokers=Math.max(0,jokers-1); break; } jokers++; }
    cur=addDayYMD(cur,-1);
    if(startDate()&&cur<startDate()) break;
  }
  return {days:days,jokers:jokers};
}
function bestStreakDays(){
  const l=weighIns(); let best=0,run=0,prev=null;
  for(const e of l){ if(prev&&diffDays(prev,e.date)===1) run++; else run=1; if(run>best) best=run; prev=e.date; }
  return best;
}
function missingDaysIn(nDays){
  const set={}; weighIns().forEach(e=>set[e.date]=1);
  const out=[], sd=startDate();
  for(let i=1;i<nDays;i++){
    const d=addDayYMD(isoToday(),-i);
    if(sd&&d<sd) break;
    if(!set[d]&&!(state.ui.skippedDays||{})[d]) out.push(d);
  }
  return out.reverse();
}
function adherencePct(){
  const s=startDate(); if(!s) return null;
  const span=diffDays(s,isoToday())+1;
  return Math.round(weighIns().length/Math.max(1,span)*100);
}
function hasWeightToday(){ return mv(entryFor(isoToday()),'weight')!=null; }
function hasProfile(){ return !!(state.settings.profile.heightCm>0 && weighIns().length>0); }
function dayIndex(){ return dayNum(isoToday()); }

/* ---------- Formatage orienté « ton » ---------- */
const MINUS='−';
function sgnKg(v){ if(v==null) return '—'; if(Math.abs(v)<0.05) return '0,0'+NBSP+'kg';
  return (v>0?'+':MINUS)+nf(Math.abs(v),1)+NBSP+'kg'; }
function sgnPt(v){ if(v==null) return '—'; return (v>0?'+':(v<0?MINUS:''))+nf(Math.abs(v),1)+NBSP+'pt'; }
function fmtKg(v,dec){ return v==null?'—':nf(v,dec==null?1:dec)+NBSP+'kg'; }
function fmtRate(v){ return v==null?'—':(v>0?'+':MINUS)+nf(Math.abs(v),2)+NBSP+'kg/sem'; }
function plural(n,s,p){ return n>1?(p||s+'s'):s; }
/* Une hausse n'est JAMAIS rouge sur l'accueil : elle est grise. Le rouge est réservé aux erreurs techniques. */
function deltaClass(v,goodDir){
  if(v==null||Math.abs(v)<0.05) return 'delta--flat';
  return (v*(goodDir||-1)>0)?'delta--good':'delta--soft';
}
function greeting(){
  const h=new Date().getHours();
  if(h<5) return 'Déjà debout ?';
  if(h<11) return 'Bonjour';
  if(h<18) return 'Salut';
  if(h<23) return 'Bonsoir';
  return 'Bonne nuit';
}

/* ---------- Équivalents concrets : rendre les kilos palpables ---------- */
const EQUIV=[
  [0.5,'un paquet de pâtes','🍝'], [1,'une bouteille d’eau d’un litre','💧'],
  [1.5,'un ordinateur portable','💻'], [2,'un pack de 2 bouteilles d’eau','💧'],
  [2.5,'un gros chat','🐈'], [3,'une brique de 3 litres de lait','🥛'],
  [4,'un pack de 4 bouteilles d’eau','💧'], [5,'un sac de patates de 5 kg','🥔'],
  [6,'un pack de 6 bouteilles d’eau','💧'], [7.5,'un bébé de 6 mois','👶'],
  [9,'une roue de voiture','🛞'], [10,'un sac de ciment de 10 kg','🧱'],
  [12,'un pack de 12 bouteilles d’eau','💧'], [15,'un vélo de ville','🚲'],
  [18,'un carton de déménagement plein','📦'], [20,'deux sacs de ciment','🧱'],
  [25,'un sac de plâtre de 25 kg','🪣'], [30,'un enfant de 9 ans','🧒'],
  [35,'un gros chien','🐕'], [40,'un lave-vaisselle','🍽️'], [50,'un sac de sable de 50 kg','🏖️']];
function equivFor(kg){ let best=null; for(const e of EQUIV) if(kg>=e[0]-1e-9) best=e; return best; }
function equivShort(kg){ const e=equivFor(kg); return e?('≈ '+e[1]):null; }
function equivLine(kg){ const e=equivFor(kg); if(!e) return null;
  return 'Tu portes '+e[1]+' en moins, toute la journée, à chaque escalier.'; }
function fatVolumeLine(kgFat){ if(kgFat==null||kgFat<1) return null;
  const L=kgFat/0.9; return nf(L,1)+' litres de graisse en moins — l’équivalent de '+Math.round(L)+' '+plural(Math.round(L),'brique')+' de lait.'; }
function effortLine(kg){ if(kg==null||kg<2) return null;
  return 'Sur 10 000 pas, tu transportes environ '+Math.round(kg*7)+' kcal d’effort en moins qu’au départ.'; }

/* ============================================================
   PALIERS (milestones)
   ============================================================ */
function milestoneDefs(){
  return cached('msdefs',()=>{
    const w0=startWeight(), tg=targetWeight(), L=[];
    const push=(code,kind,th,label,icon,why,bmi)=>L.push({code:code,kind:kind,th:th,label:label,icon:icon,why:why||null,bmi:bmi||null});
    if(w0!=null){
      [1,2,2.5,3,5,7.5,10,12.5,15,17.5,20,25,30,35,40,45,50].forEach(k=>{
        if(tg==null||w0-k>=tg-0.001) push('lost'+String(k).replace('.','_'),'lost',k,MINUS+nf(k,1)+' kg au compteur','trend'); });
      const floor=(tg!=null)?Math.floor(tg/5)*5:Math.max(50,Math.floor(w0/5)*5-15);
      for(let w=Math.floor(w0/5)*5; w>=floor; w-=5){
        if(w>=w0) continue;
        push('under'+w,'under',w,'Passer sous '+w+' kg',(w%10===0)?'target':'sparkle',(w%10===0)?'Le premier chiffre change.':null);
      }
      [35,30,27,25].forEach(b=>{ const wt=weightForBmi(b);
        if(wt!=null&&wt<w0) push('bmi'+b,'under',Math.round(wt*10)/10,'IMC sous '+b,'gauge','soit '+fmtKg(wt),b); });
      /* Deux paliers « miroir » qui parlent plus qu'un chiffre rond. */
      [10,20,25].forEach(pc=>{ const k=Math.round(w0*pc/100*10)/10;
        if(tg==null||w0-k>=tg-0.001) push('rel'+pc,'lost',k,pc+' % de ton poids de départ','layers','soit '+fmtKg(k)); });
      if(metricOn('fat')){
        [1,2,3,5,7.5,10,12.5,15,20].forEach(k=>push('fat'+String(k).replace('.','_'),'fatlost',k,MINUS+nf(k,1)+' kg de masse grasse','flame'));
        [35,32,30,28,25,22,20,18,15].forEach(pc=>push('fatp'+pc,'fatunder',pc,'Masse grasse sous '+pc+' %','flame'));
      }
    }
    [10,25,33,50,66,75,90].forEach(p=>push('pct'+p,'pct',p,p+' % du chemin','target'));
    [3,7,14,21,30,60,100,150,200,300,365].forEach(d=>push('streak'+d,'streak',d,d+' jours de suite','bolt'));
    [10,25,50,100,150,250,365,500].forEach(n=>push('count'+n,'count',n,n+' pesées enregistrées','table'));
    [2,4,8,12,26,52,104].forEach(w=>push('weeks'+w,'weeks',w,w+' '+plural(w,'semaine')+' de suivi','calendar'));
    if((state.motivations||[]).length) [1,3,5].forEach(n=>push('why'+n,'motivations',n,n===1?'Une raison écrite':n+' raisons écrites','quote'));
    if(state.settings.modules.sport){
      [1,5,10,25,50,100,150,200,300].forEach(n=>push('sess'+n,'sessions',n,n===1?'Première séance notée':n+' séances de sport','dumbbell'));
      [5,10,25,50,100,200].forEach(h=>push('hrs'+h,'sporthours',h,h+' h d’entraînement','clock'));
      [4,8,12,26,52].forEach(w=>push('spw'+w,'sportweeks',w,w+' '+plural(w,'semaine')+' d’affilée avec du sport','refresh'));
      [3,5,8].forEach(n=>push('acts'+n,'activities',n,n+' activités différentes essayées','sparkle'));
      [5000,15000,50000,100000].forEach(k=>push('skc'+k,'sportkcal',k,nf(k,0)+' kcal brûlées en séance','flame'));
    }
    if(state.settings.modules.kcalIn) [7,30,100,200,365].forEach(n=>push('kin'+n,'kcaldays',n,n+' '+plural(n,'jour')+' de calories notées','plate'));
    if(state.settings.modules.pillbox) [7,30,100,200].forEach(n=>push('pill'+n,'pilldays',n,n+' '+plural(n,'jour')+' de pilulier complet','pill'));
    return L;
  });
}
/* Poids retenu pour les paliers : le plus favorable entre la pesée du jour et la tendance. */
function milestoneWeightKg(){
  const raw=mv(lastWeighIn(),'weight'), tr=trendNow();
  if(raw==null) return tr;
  if(tr==null) return raw;
  const w0=startWeight(), tg=targetWeight();
  const versLeBas=(tg==null||w0==null)?true:(tg<=w0);
  return versLeBas?Math.min(raw,tr):Math.max(raw,tr);
}
function milestoneValue(def){
  switch(def.kind){
    case 'lost':       { const w0=startWeight(), w=milestoneWeightKg();
                         return (w0==null||w==null)?null:Math.round((w0-w)*100)/100; }
    case 'under':      { const w=milestoneWeightKg(); return w!=null?-w:null; }
    case 'fatlost':    { const c=totalDelta(PICK_FATK); return c?-c.delta:null; }
    case 'fatunder':   { const e=lastWeighIn(), v=e?mv(e,'fat','pct'):null; return v!=null?-v:null; }
    case 'pct':        { const p=goalProgressPct(); return p!=null?p*100:null; }
    case 'streak':     return streakInfo().days;
    case 'count':      return weighIns().length;
    case 'weeks':      { const d=sinceStartDays(); return d!=null?Math.floor(d/7):null; }
    case 'motivations':return (state.motivations||[]).filter(m=>m.active!==false).length;
    case 'sessions':   return (state.sessions||[]).length;
    case 'sporthours': return Math.floor((state.sessions||[]).reduce((s,x)=>s+(x.durationMin||0),0)/60);
    case 'sportweeks': return streakWeeks();
    case 'activities': { const k={}; (state.sessions||[]).forEach(s=>k[s.activityKey]=1); return Object.keys(k).length; }
    case 'sportkcal':  return Math.round((state.sessions||[]).reduce((s,x)=>s+(x.kcal!=null?x.kcal
                         :estimateKcal(x.activityKey,x.durationMin,x.intensity,x.date).kcal),0));
    case 'kcaldays':   return state.entries.filter(e=>mv(e,'kcalIn')!=null).length;
    case 'pilldays':   return pillPerfectDays();
  }
  return null;
}
/* Jours de pilulier complets depuis l'activation du module — sans juger le futur. */
function pillPerfectDays(){
  if(!state.settings.modules.pillbox) return 0;
  return cached('pillperf',()=>{
    const floor=state.settings.pillbox.floorDate||isoToday();
    let n=0, d=pillToday(), guard=0;
    while(guard++<800&&d>=floor){
      const c=pillDayCounts(d);
      if(c.expected>0&&c.taken>=c.expected) n++;
      d=addDayYMD(d,-1);
    }
    return n;
  });
}
const MS_UNDER={under:1,fatunder:1};
function milestoneReached(def){ const v=milestoneValue(def); if(v==null) return false;
  return MS_UNDER[def.kind]?(v>=-def.th):(v>=def.th); }
function milestoneRemain(def){ const v=milestoneValue(def); if(v==null) return null;
  return MS_UNDER[def.kind]?((-def.th)-v):(def.th-v); }
function defByCode(c){ const L=milestoneDefs(); for(const d of L) if(d.code===c) return d; return null; }
function checkMilestones(opt){
  opt=opt||{};
  state.milestones=state.milestones||[];
  const known={}; state.milestones.forEach(m=>known[m.code]=1);
  let fresh=0;
  milestoneDefs().forEach(d=>{
    if(known[d.code]) return;
    if(milestoneReached(d)){ state.milestones.push({code:d.code,reachedAt:isoToday(),value:milestoneValue(d),seenAt:null}); fresh++; }
  });
  if(fresh) saveNow();
  if(opt.celebrate===false) return;
  const unseen=state.milestones.filter(m=>!m.seenAt).map(m=>defByCode(m.code)).filter(Boolean);
  if(unseen.length) celebrateMilestones(unseen);
}
function milestoneCheer(d){
  const X=d.th;
  if(d.bmi) return 'Ton IMC passe sous '+d.bmi+'. Ce n’est qu’un chiffre, mais c’est un chiffre que les médecins regardent — et il va dans le bon sens.';
  switch(d.kind){
    case 'lost': return nf(X,1)+' kg en moins depuis le début. C’est du poids que tu ne portes plus, toute la journée.';
    case 'under': return (X%10===0)
      ? 'Le premier chiffre a changé. Tu es passé sous les '+nf(X,0)+' kg. Ce genre de cap, on s’en souvient.'
      : 'Sous les '+nf(X,X%1?1:0)+' kg. Petit cap, vraie progression.';
    case 'fatlost': return nf(X,1)+' kg de gras en moins. C’est ça qui compte vraiment, pas seulement l’aiguille de la balance.';
    case 'pct': return X+' % du chemin. '+(X>=50?'Tu es plus près de l’arrivée que du départ.':'Tu es bien lancé.');
    case 'streak': return X+' jours de pesées d’affilée. La régularité, c’est l’essentiel du travail.';
    case 'count': return X+'e pesée enregistrée. Tu as construit un vrai historique — plus personne ne peut te raconter d’histoires sur ton poids.';
    case 'fatunder': return 'Ta masse grasse passe sous '+X+' %. C’est la mesure qui parle vraiment de ton corps, pas seulement de ton poids.';
    case 'weeks': return X+' '+plural(X,'semaine')+' que tu suis ça. Les résultats viennent du temps, et le temps, tu le mets.';
    case 'motivations': return X===1?'Ta première raison est écrite. Les matins gris, c’est elle que tu reliras.':X+' raisons écrites. Tu sais pourquoi tu fais ça, et c’est le plus important.';
    case 'sessions': return X===1?'Première séance notée. C’est souvent celle-là la plus dure.':X+' séances. Ton corps a compris le message.';
    case 'sporthours': return X+' heures d’entraînement cumulées. C’est du temps investi en toi, pas ailleurs.';
    case 'sportweeks': return X+' '+plural(X,'semaine')+' d’affilée sans en sauter une seule. C’est ça, une habitude.';
    case 'activities': return X+' activités différentes. Varier, c’est la meilleure façon de ne pas se lasser.';
    case 'sportkcal': return nf(X,0)+' kcal brûlées à l’entraînement depuis le début.';
    case 'kcaldays': return X+' '+plural(X,'jour')+' de calories notées. C’est cette régularité qui rend le calcul de ta dépense réelle possible.';
    case 'pilldays': return X+' '+plural(X,'jour')+' de pilulier complet. Prendre soin de soi, c’est aussi ça.';
  }
  return 'Un cap de plus. Continue.';
}
function celebrateMilestones(list){
  const main=list[0], others=list.slice(1);
  state.milestones.forEach(m=>{ if(!m.seenAt) m.seenAt=new Date().toISOString(); });
  saveNow();
  if(state.settings.celebrateOn!==false){ confetti(); haptic(35); }
  let extra='';
  if(main.kind==='lost'){ const e=equivLine(main.th); if(e) extra+='<p class="muted small" style="margin-top:10px">'+esc(e)+'</p>'; }
  if(main.kind==='fatlost'){ const e=fatVolumeLine(main.th); if(e) extra+='<p class="muted small" style="margin-top:10px">'+esc(e)+'</p>'; }
  openSheet('Palier franchi !',
    '<div class="center" style="padding:6px 0 4px">'
    +'<div class="ms-hero">'+ic(main.icon,'ic--xl')+'</div>'
    +'<div style="font-size:22px;font-weight:700;margin-top:8px">'+esc(main.label)+'</div>'
    +'<p class="muted" style="margin:10px auto 0;max-width:300px;font-size:14.5px;line-height:1.5">'+esc(milestoneCheer(main))+'</p>'
    +extra
    +(others.length?'<div class="chip-wrap" style="justify-content:center;margin-top:14px">'
        +others.map(d=>'<span class="chip">'+ic(d.icon,'ic--sm')+' '+esc(d.label)+'</span>').join('')+'</div>':'')
    +'</div>'
    +'<button class="btn btn--primary btn--block" data-act="close-sheet" style="margin-top:20px">Continuer</button>');
}
function nextMilestone(){
  const seen={}; (state.milestones||[]).forEach(m=>seen[m.code]=1);
  let best=null;
  milestoneDefs().forEach(d=>{
    if(seen[d.code]) return;
    const rem=milestoneRemain(d); if(rem==null||rem<=0) return;
    const w=(d.kind==='under'||d.kind==='lost')?1:((d.kind==='fatlost'||d.kind==='fatunder')?1.6:2.6);
    const score=rem*w;
    if(!best||score<best.score) best={def:d,rem:rem,score:score};
  });
  if(!best) return null;
  const v=milestoneValue(best.def);
  const th=MS_UNDER[best.def.kind]?-best.def.th:best.def.th;
  const ref=(best.def.kind==='under')?(-(startWeight()||0)):0;
  const pct=clamp((v-ref)/Math.max(0.001,th-ref),0,1);
  let txt;
  const k=best.def.kind;
  const R=Math.ceil(best.rem);
  if(k==='under'||k==='lost'||k==='fatlost') txt='encore '+fmtKg(best.rem);
  else if(k==='fatunder') txt='encore '+nf(best.rem,1)+' point'+(best.rem>=2?'s':'');
  else if(k==='pct') txt='encore '+R+' %';
  else if(k==='streak'||k==='kcaldays'||k==='pilldays') txt='encore '+R+' '+plural(R,'jour');
  else if(k==='count') txt='encore '+R+' '+plural(R,'pesée');
  else if(k==='weeks'||k==='sportweeks') txt='encore '+R+' '+plural(R,'semaine');
  else if(k==='sessions') txt='encore '+R+' '+plural(R,'séance');
  else if(k==='sporthours') txt='encore '+R+' h';
  else if(k==='sportkcal') txt='encore '+nf(R,0)+' kcal';
  else if(k==='activities') txt='encore '+R+' '+plural(R,'activité');
  else txt='encore '+R;
  return {def:best.def,rem:best.rem,remainText:txt,pct:pct};
}

/* ============================================================
   INSIGHTS — « le mot du jour »
   ------------------------------------------------------------
   Règles de ton non négociables : jamais de conseil médical,
   jamais de culpabilisation, taille d'échantillon toujours
   visible, corrélation ≠ causalité, et une remontée de poids
   est d'abord EXPLIQUÉE (eau, sel, sport, sommeil) avant d'être
   chiffrée.
   ============================================================ */
function buildInsights(){
  const out=[];
  const add=(id,prio,icon,text,route,tone)=>{ if(text) out.push({id:id,prio:prio,icon:icon,text:text,route:route||null,tone:tone||'neutral'}); };
  const nW=weighIns().length;
  const ref=refWeight(), tr=trendRate(), rate=bestRate(), lost=kgLost();
  const st=streakInfo();

  if(!hasWeightToday()) add('saisie_manquante',100,'scale','Pas encore pesé aujourd’hui. Dix secondes et c’est fait.');
  else add('saisie_ok',99,'check','Pesée du jour enregistrée'+(st.days>1?' — '+st.days+' jours d’affilée.':'.'));

  const last=lastWeighIn();
  if(last){ const gap=diffDays(last.date,isoToday());
    if(gap>=3) add('retour_apres_pause',96,'hand','Content de te revoir. '+gap+' jours sans pesée : on repart d’aujourd’hui, il n’y a rien à rattraper.'); }

  const dc=classifyDailyChange();
  if(dc.code==='retention_eau') add('retention_eau',88,'droplet',dc.text,'/courbes');
  else if(dc.code==='bruit') add('bruit_journalier',60,'ruler',dc.text);
  else if(dc.code==='baisse_forte') add('baisse_forte',70,'trend',dc.text);

  const pl=detectPlateau();
  if(pl.isPlateau){
    const cf=compDelta(PICK_FATK,Math.max(21,pl.sinceDays));
    if(cf.ok&&cf.delta<=-0.5)
      add('plateau_gras',86,'search','Ton poids fait une pause depuis '+pl.sinceDays+' jours, mais ta masse grasse a baissé de '+fmtKg(-cf.delta)+'. La balance ne raconte qu’une partie de l’histoire.','/analyse','pos');
    else
      add('plateau',82,'layers','Ton poids fait une pause depuis '+pl.sinceDays+' jours (±0,15 kg/semaine). C’est la phase la plus normale d’une perte de poids.','/courbes');
  }
  if(tr.ok&&ref.kg&&tr.kgWeek<0){
    const pctWeek=100*(-tr.kgWeek)/ref.kg;
    if(pctWeek>1.2) add('rythme_rapide',81,'gauge','Tu perds '+nf(pctWeek,1)+' % de ton poids par semaine. Au-delà de 1 % par semaine, la part de masse maigre perdue augmente mécaniquement.','/analyse');
  }
  const qual=lossQuality(28);
  if(qual.ok&&qual.ratio<0.25)
    add('perte_maigre',80,'meat','Sur 28 jours, '+qual.pct+' % seulement de ce que tu as perdu est de la graisse d’après ta balance. À lire en tendance : l’impédance n’est pas une mesure au dixième.','/analyse');
  else if(qual.ok&&qual.ratio>=0.5)
    add('qualite_perte',72,'heart',qual.pct+' % de ce que tu as perdu est de la graisse. Qualité de perte '+qual.label+'.','/analyse','pos');

  if(lost!=null&&lost>=0.5&&startDate())
    add('perte_totale',78,'trend',fmtKg(lost)+' perdus depuis le '+fmtDateShort(startDate())+' ('+sinceStartDays()+' jours).','/courbes','pos');

  const ed=etaDays();
  if(ed!=null&&ed>0) add('eta',77,'target','À ce rythme, objectif atteint vers le '+fmtDateLong(etaDate())+' (dans '+humanDuration(ed)+').','/objectif');
  else if(targetWeight()!=null&&rate!=null&&rate>=-0.05)
    add('eta_pause',77,'hourglass','Ton poids fait une pause : pas de date fiable pour l’instant. Elle reviendra dès que la baisse repart.','/objectif');

  if(tr.ok&&tr.significant&&tr.kgWeek<0)
    add('rythme_actuel',76,'trend','Tu perds '+fmtKg(-tr.kgWeek)+' par semaine en ce moment, sur '+tr.n+' pesées.','/courbes','pos');

  if(state.settings.modules.kcalIn){
    const td=tdeeObserved();
    if(td.ok){
      const scale=lastScaleKcal();
      add('depense_reelle',75,'flame','D’après ce que tu manges ('+nf(td.intake,0)+' kcal/jour) et ce que tu perds, ta dépense réelle tourne autour de '+nf(td.kcal,0)+' kcal par jour.'
        +(scale?' Ta balance affiche '+nf(scale,0)+' : elle estime, elle ne mesure pas.':''),'/analyse');
    }
    const xc=crossCorrIntakeWeight();
    if(xc.ok&&xc.solid&&xc.best.lag>=2)
      add('lag_calories',74,'plate','Chez toi, un gros apport se voit surtout '+xc.best.lag+' '+plural(xc.best.lag,'jour')+' après : +1 000 kcal ≈ '+sgnKg(xc.best.beta*1000)+', sur '+xc.best.n+' journées comparées.','/courbes');
    else if(xc.ok&&xc.solid&&xc.best.lag===1)
      add('lag_calories',74,'plate','Chez toi, ce que tu manges se voit dès le lendemain matin : +1 000 kcal ≈ '+sgnKg(xc.best.beta*1000)+', sur '+xc.best.n+' journées comparées.','/courbes');
    const eb=energyBalance();
    if(eb.ok&&eb.ratio!=null){
      if(eb.ratio>=0.8&&eb.ratio<=1.25) add('deficit_ok',73,'check','Ton déficit prévoyait '+fmtKg(-eb.expectedKgWeek)+'/semaine, tu perds '+fmtKg(-eb.actualKgWeek)+'/semaine : ça colle. Tes chiffres sont fiables.','/analyse','pos');
      else if(eb.ratio>1.25) add('deficit_vite',73,'bolt','Tu perds plus vite que ce que ton déficit prévoit. Souvent de l’eau et du glycogène en début de période — ça se stabilisera.','/analyse');
      else if(eb.ratio>=0.4) add('deficit_lent',73,'search','Tu perds moins vite que le calcul ('+Math.round(eb.ratio*100)+' % du prévu). Les trois causes les plus fréquentes : des calories non comptées, une dépense réelle plus basse que l’estimation, ou de l’eau qui masque la perte.','/analyse');
      else add('deficit_ecart',73,'search','Gros écart entre le calcul et la réalité. Le plus souvent, ce sont les portions estimées. Fie-toi à ta dépense observée plutôt qu’au théorique.','/analyse');
    }
  }
  const wd=weekdayEffect();
  if(wd.ok&&wd.notable){
    let t='Ton poids du '+wd.hi.label+' est en moyenne '+fmtKg(wd.gap)+' au-dessus de ton '+wd.lo.label+'. C’est le rythme de ta semaine, pas de la graisse qui apparaît et disparaît.';
    if(wd.hi.dow===0||wd.hi.dow===1) t+=' Le classique effet week-end.';
    add('effet_weekend',68,'calendar',t,'/analyse');
  }
  if(state.settings.modules.sport){
    const se=sportEffect();
    if(se.ok&&se.diff<-0.15) add('sport_effet',66,'dumbbell','Les semaines où tu t’entraînes au moins deux fois, tu perds en moyenne '+fmtKg(-se.diff)+' de plus ('+se.nA+' semaines actives contre '+se.nB+' calmes).','/sport','pos');
    else if(se.ok&&Math.abs(se.diff)<=0.15) add('sport_effet',66,'dumbbell','Pas d’écart net entre tes semaines avec et sans entraînement sur la balance. Le sport agit surtout sur ce que la balance ne voit pas : le muscle gardé et la forme.','/sport');
    else if(se.ok) add('sport_effet',66,'droplet','Tes semaines actives montrent un peu moins de perte. C’est classique : après une grosse séance, le muscle retient de l’eau pendant 24 à 72 h.','/sport');
  }
  const mus=compDelta(PICK_MUSK,28), wch=compDelta(PICK_W,28);
  if(mus.ok&&wch.ok&&Math.abs(mus.delta)<=0.5&&wch.delta<=-2)
    add('muscle_garde',65,'layers','Tu as perdu '+fmtKg(-wch.delta)+' sans perdre de muscle. C’est exactement le but. (mesure d’impédance : à lire en tendance)','/analyse','pos');

  const nm=nextMilestone();
  if(nm&&rate!=null&&rate<0&&(nm.def.kind==='under'||nm.def.kind==='lost'))
    add('prochain_palier',64,nm.def.icon,nm.def.label+' : '+nm.remainText+' — environ '+humanDuration(Math.ceil(nm.rem/(-rate/7)))+' au rythme actuel.','/objectif');

  if(nW<8) add('donnees_insuffisantes',30,'sprout','Encore quelques pesées et je pourrai calculer ta tendance. Une par matin suffit.');
  return out;
}
const INSIGHT_MAX_HOME=3;
function pickInsights(list,max){
  const fam=i=>i.id.split('_')[0], out=[], usedFam={};
  const seen=state.ui.insightSeen||{};
  const today=isoToday();
  list.slice().sort((a,b)=>b.prio-a.prio).forEach(i=>{
    if(out.length>=(max||INSIGHT_MAX_HOME)) return;
    if(i.cooldown&&seen[i.id]&&diffDays(seen[i.id],today)<i.cooldown) return;
    if(usedFam[fam(i)]) return;
    usedFam[fam(i)]=1; out.push(i);
  });
  return out;
}
/* Ces insights ont déjà leur propre carte sur l'accueil : les répéter en « mot du jour »
   ferait dire deux fois la même chose dans le même écran. Ils restent dans Analyse. */
const INSIGHT_NOT_ON_HOME=['saisie_manquante','saisie_ok','perte_totale','eta','eta_pause','prochain_palier'];
function insightOfTheDay(){
  const l=buildInsights().filter(i=>i.prio<99&&INSIGHT_NOT_ON_HOME.indexOf(i.id)<0);
  if(!l.length) return null;
  const top=pickInsights(l,3);
  return top.length?top[dayIndex()%top.length]:null;
}
function lastScaleKcal(){ for(let i=state.entries.length-1;i>=0;i--){ const v=mv(state.entries[i],'kcalOut'); if(v!=null) return v; } return null; }

/* Repli pédagogique quand le moteur n'a rien de neuf à dire. */
function fallbackTip(){
  const rate=bestRate(), lost=kgLost();
  const fat=totalDelta(PICK_FATK), mus=totalDelta(PICK_MUSK);
  const T=[];
  T.push({id:'water',icon:'droplet',text:'Une variation d’un kilo du jour au lendemain, c’est de l’eau, pas du gras. Regarde la ligne de tendance, pas le point.'});
  if(adherencePct()!=null&&adherencePct()<80) T.push({id:'sameTime',icon:'clock',text:'Le meilleur moment pour se peser : le matin, après être passé aux toilettes, avant de manger. Toujours le même. Le reste, c’est du bruit.'});
  if(rate!=null&&rate>-0.1&&rate<0.1&&(sinceStartDays()||0)>21) T.push({id:'plateau',icon:'layers',text:'Ta courbe fait un palier. C’est la phase la plus normale du monde : le corps se réajuste. Ne change rien pendant dix jours, et regarde.'});
  if(rate!=null&&rate<-1.2) T.push({id:'fast',icon:'gauge',text:'Tu perds vite. Sur la durée, entre 0,4 et 0,8 kg par semaine, c’est plus tenable — et on garde plus de muscle.'});
  if(mus&&mus.delta<-0.5) T.push({id:'muscle',icon:'meat',text:'Ta masse musculaire baisse un peu en même temps que le poids. Un peu de résistance et des protéines aident à ne perdre que le gras.'});
  if(lost!=null&&lost>=1){ const e=equivLine(lost); if(e) T.push({id:'equiv',emoji:'',text:e}); }
  if(lost!=null&&lost>=2){ const e=effortLine(lost); if(e) T.push({id:'effort',emoji:'',text:e}); }
  if(fat&&fat.delta<=-1){ const e=fatVolumeLine(-fat.delta); if(e) T.push({id:'fatVol',emoji:'',text:e}); }
  if(streakInfo().days>=14) T.push({id:'streakWin',icon:'flame',text:streakInfo().days+' jours d’affilée. Ce n’est plus un effort, c’est une habitude.'});
  if(state.settings.modules.kcalIn&&daysTracked()>=21) T.push({id:'kcalLag',icon:'plate',text:'Ce que tu manges aujourd’hui se voit surtout sur la balance dans deux jours. Ne juge jamais un repas au réveil suivant.'});
  if(state.settings.modules.sport){
    const w7=(state.sessions||[]).filter(s=>s.date>=addDayYMD(isoToday(),-6)).length;
    if(w7===0) T.push({id:'sport',icon:'walk',text:'Pas de séance cette semaine ? Vingt minutes de marche comptent aussi. Pas besoin d’être héroïque tous les jours.'});
    else if(w7>=3) T.push({id:'sportWin',icon:'dumbbell',text:w7+' séances cette semaine. C’est ça qui construit le corps qui restera après la perte.'});
  }
  if(typeof backupOverdue==='function'&&backupOverdue()) T.push({id:'backup',icon:'save',text:'Pense à exporter une sauvegarde. Ce serait bête de perdre tous ces matins de saisie.',route:'/sauvegarde'});
  const t=trendNow(), nb=t!=null?nextBmiThreshold(t):null;
  if(nb&&nb.remainKg<=5) T.push({id:'bmiNext',icon:'trend',text:'Encore '+fmtKg(nb.remainKg)+' et ton IMC passe sous '+nb.bmi+'. C’est le prochain vrai cap.'});
  if(!T.length) return null;
  return T[dayIndex()%T.length];
}

/* @@SECTION:MODELE@@ */

/* ============================================================
   BIBLIOTHÈQUE GRAPHIQUE (SVG fait maison, zéro dépendance)
   ------------------------------------------------------------
   Principe « mesurer puis dessiner » : on construit le SVG à la
   largeur réelle en pixels du conteneur (échelle 1:1) — traits
   nets, textes à la bonne taille, pas de déformation.
   L'axe X est TOUJOURS calendaire : un trou de 5 jours occupe
   vraiment 5 jours de largeur. Un trait plein rompu + un pont
   pointillé disent la vérité sur les jours non pesés.
   ============================================================ */
const CH_H=216, CH_H2=152, CH_SPARK_H=48;
let CHART_SEQ=0, CHART_QUEUE=[], CHART_META={};

function chartSlot(build,opts){
  opts=opts||{};
  const id=opts.id||('ch'+(++CHART_SEQ)); opts.id=id;
  CHART_QUEUE.push({id:id,build:build,opts:opts});
  return '<div class="chart-slot'+(opts.hscroll?' chart-hscroll':'')+'" id="slot-'+id+'" style="height:'+(opts.h||CH_H)+'px"></div>';
}
function mountCharts(animate){
  const list=CHART_QUEUE; CHART_QUEUE=[];
  list.forEach(it=>{
    const el=document.getElementById('slot-'+it.id); if(!el) return;
    const w=Math.max(240,Math.round(el.clientWidth||490));
    el.style.height='';
    el.innerHTML=it.build(w);
    if(it.opts.scrub) wireScrub(el,it.id);
    if(it.opts.hscroll){ try{ el.scrollLeft=el.scrollWidth; }catch(e){} }
    if(animate&&!motionOff()) animateChart(el);
    else qa('g.bars-in',el).forEach(g=>g.classList.add('on'));   // sans animation, on montre tout de suite
  });
}
function padFor(o){ return { t:14, r:(o&&o.rightAxis)?38:12, b:22, l:(o&&o.noYAxis)?8:38 }; }
function r1(n){ return Math.round(n*10)/10; }

/* Échelle Y « jolie » : bornes et graduations arrondies. */
function niceNum(x,doRound){
  if(!(x>0)) return 1;
  const exp=Math.floor(Math.log(x)/Math.LN10), f=x/Math.pow(10,exp);
  const nfc=doRound ? (f<1.5?1:f<3?2:f<7?5:10) : (f<=1?1:f<=2?2:f<=5?5:10);
  return nfc*Math.pow(10,exp);
}
function niceScale(min,max,ticks){
  ticks=ticks||4;
  if(!isFinite(min)||!isFinite(max)) return {min:0,max:1,step:1,ticks:[0,1]};
  if(min===max){ const p=Math.abs(min)>10?Math.abs(min)*0.02:0.5; min-=p; max+=p; }
  const step=niceNum((max-min)/Math.max(1,ticks-1),true);
  const lo=Math.floor(min/step)*step, hi=Math.ceil(max/step)*step;
  const out=[]; for(let v=lo; v<=hi+step*1e-6; v+=step) out.push(+v.toFixed(6));
  return {min:lo,max:hi,step:step,ticks:out};
}

/* Trait plein, rompu dès qu'il manque plus de `gap` jours. */
function pathLine(pts,X,Y,gap){
  let d='', prev=null;
  for(let i=0;i<pts.length;i++){ const p=pts[i];
    d+=((prev===null||(dayNum(p.date)-dayNum(prev.date))>gap)?'M':'L')+r1(X(p.date))+' '+r1(Y(p.v));
    prev=p; }
  return d;
}
/* Ponts pointillés sur les trous : « la tendance passe par là, mais personne n'a pesé ». */
function pathBridges(pts,X,Y,gap){
  let d='';
  for(let i=1;i<pts.length;i++){
    if(dayNum(pts[i].date)-dayNum(pts[i-1].date)>gap)
      d+='M'+r1(X(pts[i-1].date))+' '+r1(Y(pts[i-1].v))+'L'+r1(X(pts[i].date))+' '+r1(Y(pts[i].v));
  }
  return d;
}
function bucketize(pts,maxN){
  if(pts.length<=maxN) return pts;
  const k=Math.ceil(pts.length/maxN), out=[];
  for(let i=0;i<pts.length;i+=k){
    const sl=pts.slice(i,i+k); let s=0; for(const p of sl) s+=p.v;
    out.push({date:sl[Math.floor(sl.length/2)].date, v:s/sl.length, agg:sl.length});
  }
  return out;
}
/* Moyenne mobile sur une fenêtre CALENDAIRE glissante (pas « les 7 derniers points »),
   en mode « trailing » pour couvrir aussi les tout derniers jours. */
function movingAvgCal(pts,win){
  const out=[]; let j=0;
  for(let i=0;i<pts.length;i++){
    const dn=dayNum(pts[i].date);
    while(j<i && dayNum(pts[j].date)<dn-(win-1)) j++;
    let s=0,n=0; for(let k=j;k<=i;k++){ s+=pts[k].v; n++; }
    if(n>=2) out.push({date:pts[i].date,v:s/n});
  }
  return out;
}
function xTicks(from,to,n){
  const a=dayNum(from), b=dayNum(to); if(b<=a) return [from];
  const out=[]; for(let i=0;i<n;i++) out.push(numDay(Math.round(a+(b-a)*i/(n-1)))); return out;
}
function fmtAxisDate(s,span){
  const d=new Date(dayNum(s)*86400000);
  if(span<=45) return d.getUTCDate()+' '+MOIS3[d.getUTCMonth()];
  if(span<=200) return MOIS3[d.getUTCMonth()];
  return MOIS3[d.getUTCMonth()]+' '+String(d.getUTCFullYear()).slice(2);
}

/**
 * series : [{key,label,color,unit,dec,points:[{date,v}],axis:'left'|'right',dash,width,dots,area}]
 * opts   : {w,h,from,to,goal:{v,label,color},avg:{win,mode},rightAxis,noYAxis,scrub,id,readoutId,yUnit}
 */
function lineChart(series,opts){
  opts=opts||{};
  const W=opts.w||490, H=opts.h||CH_H, pad=padFor(opts);
  const plotW=W-pad.l-pad.r, plotH=H-pad.t-pad.b;
  const from=opts.from, to=opts.to, span=Math.max(0,dayNum(to)-dayNum(from));
  /* `opts.gap` prime sur le réglage global : une mesure mensuelle n'a pas
     le même « trou normal » qu'une pesée quotidienne. */
  const gap=opts.gap||(state.ui&&state.ui.charts&&state.ui.charts.gapDays)||2;
  const live=(series||[]).filter(s=>s&&s.points&&s.points.length);
  const X=d=>span?pad.l+((dayNum(d)-dayNum(from))/span)*plotW:pad.l+plotW/2;

  if(!live.length){
    return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img">'
      +'<text class="chart-empty" x="'+(W/2)+'" y="'+(H/2)+'" text-anchor="middle">Aucune donnée sur cette période</text></svg>';
  }

  /* Domaines : un par axe (gauche / droite) */
  function domainOf(list,withGoal){
    let mn=Infinity,mx=-Infinity;
    list.forEach(s=>s.points.forEach(p=>{ if(p.v<mn) mn=p.v; if(p.v>mx) mx=p.v; }));
    if(withGoal&&opts.goal&&isNum(opts.goal.v)){
      const mid=(mn+mx)/2, sp=Math.max(1e-6,mx-mn);
      if(Math.abs(opts.goal.v-mid)<1.5*sp){ mn=Math.min(mn,opts.goal.v); mx=Math.max(mx,opts.goal.v); }
    }
    return niceScale(mn,mx,4);
  }
  const leftS=live.filter(s=>s.axis!=='right'), rightS=live.filter(s=>s.axis==='right');
  const dl=domainOf(leftS.length?leftS:live,true);
  const dr=rightS.length?domainOf(rightS,false):null;
  const YL=v=>pad.t+(1-(v-dl.min)/((dl.max-dl.min)||1))*plotH;
  const YR=v=>pad.t+(1-(v-dr.min)/((dr.max-dr.min)||1))*plotH;
  const yOf=s=>(s.axis==='right'&&dr)?YR:YL;

  let g='';
  /* 1. grille */
  if(!opts.noYAxis){
    dl.ticks.forEach(t=>{ const y=r1(YL(t));
      g+='<line class="ax-grid" x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'"/>'
        +'<text class="ax-lbl" x="'+(pad.l-6)+'" y="'+r1(y+3.5)+'" text-anchor="end">'+esc(nf(t,(leftS[0]&&leftS[0].dec!=null)?leftS[0].dec:1))+'</text>'; });
  }
  if(dr){
    dr.ticks.forEach(t=>{ const y=r1(YR(t));
      g+='<text class="ax-lbl" x="'+(W-pad.r+6)+'" y="'+r1(y+3.5)+'" text-anchor="start" fill="'+(rightS[0].color||'var(--tx-3)')+'" opacity=".75">'+esc(nf(t,rightS[0].dec==null?1:rightS[0].dec))+'</text>'; });
  }
  /* 2. étiquettes de dates */
  const tks=xTicks(from,to,4);
  tks.forEach((d,i)=>{ g+='<text class="ax-lbl" x="'+r1(X(d))+'" y="'+(H-5)+'" text-anchor="'+(i===0?'start':i===tks.length-1?'end':'middle')+'">'+esc(fmtAxisDate(d,span))+'</text>'; });

  /* 3. aire (une seule série, la principale) */
  const main=live[0];
  if(main.area){
    const Y=yOf(main), base=H-pad.b;
    let d='', run=[];
    const flush=()=>{ if(run.length>1){ d+='M'+r1(X(run[0].date))+' '+base;
        run.forEach(p=>{ d+='L'+r1(X(p.date))+' '+r1(Y(p.v)); });
        d+='L'+r1(X(run[run.length-1].date))+' '+base+'Z'; } run=[]; };
    main.points.forEach((p,i)=>{ if(i&&dayNum(p.date)-dayNum(main.points[i-1].date)>gap) flush(); run.push(p); });
    flush();
    if(d){ const gid='ga-'+opts.id;
      g+='<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
        +'<stop offset="0%" stop-color="'+main.color+'" stop-opacity=".22"/><stop offset="100%" stop-color="'+main.color+'" stop-opacity="0"/></linearGradient></defs>'
        +'<path d="'+d+'" fill="url(#'+gid+')"/>'; }
  }
  /* 4. bande de moyenne mobile */
  if(opts.avg && main.points.length>2){
    const Y=yOf(main), av=movingAvgCal(main.points,(opts.avg.win||7));
    if(av.length>1){
      const dd=pathLine(av,X,Y,999);
      g+='<path class="ln-avg" d="'+dd+'" stroke="'+main.color+'" stroke-width="'+(opts.avg.mode==='line'?1.8:7)+'" style="opacity:'+(opts.avg.mode==='line'?.85:.17)+'"/>';
    }
  }
  /* 5. courbes : ponts d'abord, puis traits pleins */
  live.forEach(s=>{
    const Y=yOf(s), pts=bucketize(s.points,Math.max(60,plotW*2));
    const br=pathBridges(pts,X,Y,gap);
    if(br) g+='<path class="ln-bridge" d="'+br+'" stroke="'+s.color+'" stroke-width="'+((s.width||2.2)*0.8)+'"/>';
    const dd=pathLine(pts,X,Y,gap);
    g+='<path class="ln-raw" d="'+dd+'" stroke="'+s.color+'" stroke-width="'+(s.width||2.2)+'"'
      +(s.dash?' stroke-dasharray="'+s.dash+'"':'')+(s.axis==='right'?' opacity=".8"':'')+'/>';
  });
  /* 6. points + marqueurs */
  live.forEach(s=>{
    const Y=yOf(s), pts=s.points;
    if(s.dots!==false && pts.length<=60)
      pts.forEach(p=>{ g+='<circle class="pt" cx="'+r1(X(p.date))+'" cy="'+r1(Y(p.v))+'" r="2.4" fill="'+s.color+'"/>'; });
    const last=pts[pts.length-1];
    if(s.axis!=='right'&&last){
      g+='<circle class="pt-halo" cx="'+r1(X(last.date))+'" cy="'+r1(Y(last.v))+'" r="7" fill="'+s.color+'"/>'
        +'<circle class="pt-last" cx="'+r1(X(last.date))+'" cy="'+r1(Y(last.v))+'" r="3.6" fill="'+s.color+'"/>';
    }
  });
  /* 7. objectif */
  if(opts.goal&&isNum(opts.goal.v)){
    const y=YL(opts.goal.v);
    if(y>pad.t-2&&y<H-pad.b+2){
      g+='<line class="ax-goal" x1="'+pad.l+'" y1="'+r1(y)+'" x2="'+(W-pad.r)+'" y2="'+r1(y)+'" stroke="'+(opts.goal.color||'var(--m-goal)')+'" stroke-dasharray="5 4" stroke-width="1.3"/>'
        +'<text class="ax-goal-lbl" x="'+(W-pad.r-2)+'" y="'+r1(y-5)+'" text-anchor="end">'+esc(opts.goal.label||'Objectif')+'</text>';
    }
  }
  /* 8. curseur + zone tactile */
  const dates=[]; const seen={};
  live.forEach(s=>s.points.forEach(p=>{ if(!seen[p.date]){ seen[p.date]=1; dates.push(p.date); } }));
  dates.sort();
  const xs=dates.map(X);
  CHART_META[opts.id]={ w:W,h:H,pad:pad,from:from,to:to,dates:dates,xs:xs,readoutId:opts.readoutId||null,
    series:live.map(s=>{ const by={}; s.points.forEach(p=>by[p.date]=p.v);
      return {key:s.key,label:s.label,color:s.color,dec:s.dec==null?1:s.dec,unit:s.unit||'',byDate:by,Y:yOf(s),axis:s.axis||'left'}; }) };
  g+='<line class="cursor-line" x1="0" y1="'+pad.t+'" x2="0" y2="'+(H-pad.b)+'" style="display:none"/>';
  live.forEach((s,k)=>{ g+='<circle class="cursor-dot" data-s="'+k+'" r="4" fill="'+s.color+'" style="display:none"/>'; });
  if(opts.scrub!==false) g+='<rect class="chart-hit" x="0" y="0" width="'+W+'" height="'+H+'" fill="transparent"/>';

  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img">'+g+'</svg>';
}

/**
 * bars : [{date,v,color,label}]  — position calendaire, largeur = un seau
 * opts : {w,h,from,to,bucket:'day'|'week'|'month',overlay:{points,color,dec,unit},target,dec,unit,id,fmtV}
 */
function barChart(bars,opts){
  opts=opts||{};
  const W=opts.w||490, H=opts.h||CH_H2, pad=padFor({rightAxis:!!opts.overlay});
  const plotW=W-pad.l-pad.r, plotH=H-pad.t-pad.b;
  const from=opts.from,to=opts.to,span=Math.max(1,dayNum(to)-dayNum(from));
  if(!bars.length) return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'">'
    +'<text class="chart-empty" x="'+(W/2)+'" y="'+(H/2)+'" text-anchor="middle">Rien à afficher</text></svg>';
  /* Une barre est centrée sur sa date : sans marge, la première et la dernière
     débordent d'une demi-largeur et viennent mordre sur les étiquettes d'axe. */
  const step0=(opts.bucket==='month'?30:opts.bucket==='week'?7:1);
  const nB0=Math.max(1,Math.round(span/step0)+1);
  const bw0=Math.max(3,Math.min(30,plotW/nB0-3));
  const inset=Math.min(plotW/3,bw0/2+2);
  const X=d=>pad.l+inset+((dayNum(d)-dayNum(from))/span)*(plotW-2*inset);
  let mn=0,mx=0; bars.forEach(b=>{ if(b.v<mn) mn=b.v; if(b.v>mx) mx=b.v; });
  if(opts.target&&opts.target>mx) mx=opts.target;
  const sc=niceScale(mn,mx===mn?mn+1:mx,3);
  const Y=v=>pad.t+(1-(v-sc.min)/((sc.max-sc.min)||1))*plotH;
  const bw=bw0;
  let g='';
  sc.ticks.forEach(t=>{ const y=r1(Y(t));
    g+='<line class="ax-grid" x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'"/>'
      +'<text class="ax-lbl" x="'+(pad.l-6)+'" y="'+r1(y+3.5)+'" text-anchor="end">'+esc(nf(t,opts.dec==null?0:opts.dec))+'</text>'; });
  if(sc.min<0){ const y=r1(Y(0)); g+='<line class="ax-zero" x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'"/>'; }
  if(opts.target&&opts.target>0){ const y=r1(Y(opts.target));
    g+='<line class="ax-goal" x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'" stroke="var(--acc)" stroke-dasharray="5 4" stroke-width="1.2"/>'; }
  g+='<g class="bars-in">';
  bars.forEach(b=>{
    const y0=Y(0), y1=Y(b.v||0);
    const y=Math.min(y0,y1), h=Math.max(1.5,Math.abs(y1-y0));
    g+='<rect x="'+r1(X(b.date)-bw/2)+'" y="'+r1(y)+'" width="'+r1(bw)+'" height="'+r1(h)+'" rx="'+Math.min(3,bw/2)+'" fill="'+(b.color||'var(--acc)')+'" fill-opacity="'+(b.opacity||.8)+'"/>';
  });
  g+='</g>';
  if(opts.overlay&&opts.overlay.points&&opts.overlay.points.length){
    const op=opts.overlay; let mn2=Infinity,mx2=-Infinity;
    op.points.forEach(p=>{ if(p.v<mn2) mn2=p.v; if(p.v>mx2) mx2=p.v; });
    const s2=niceScale(mn2,mx2,3);
    const Y2=v=>pad.t+(1-(v-s2.min)/((s2.max-s2.min)||1))*plotH;
    s2.ticks.forEach(t=>{ g+='<text class="ax-lbl" x="'+(W-pad.r+6)+'" y="'+r1(Y2(t)+3.5)+'" text-anchor="start" fill="'+op.color+'" opacity=".75">'+esc(nf(t,op.dec==null?1:op.dec))+'</text>'; });
    if(s2.min<0&&s2.max>0){ const y=r1(Y2(0)); g+='<line class="ax-zero" x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'"/>'; }
    /* Le pas de l'overlay suit celui des barres : des points hebdomadaires sont espaces
       de sept jours, un seuil de trois les effacerait tous. */
    const ogap=op.gap||(opts.bucket==='month'?40:opts.bucket==='week'?9:3);
    g+='<path class="ln-raw" d="'+pathLine(op.points,X,Y2,ogap)+'" stroke="'+op.color+'" stroke-width="2" opacity=".95"/>';
    if(op.points.length<=40) op.points.forEach(pt=>{
      g+='<circle cx="'+r1(X(pt.date))+'" cy="'+r1(Y2(pt.v))+'" r="2.6" fill="'+op.color+'"/>'; });
  }
  const nBars=bars.length;
  bars.forEach((b,i)=>{ const every=Math.ceil(nBars/6);
    if(b.label&&(i%every===0||i===nBars-1)) g+='<text class="ax-lbl" x="'+r1(X(b.date))+'" y="'+(H-5)+'" text-anchor="middle">'+esc(b.label)+'</text>'; });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'">'+g+'</svg>';
}

/** days : {'YYYY-MM-DD': valeur}. Grille type « contributions » : colonnes = semaines. */
function calendarHeatmap(days,opts){
  opts=opts||{};
  const cell=opts.cell||13, gp=opts.gap||2, color=opts.color||'var(--m-sport)';
  const to=opts.to||isoToday(), from=opts.from||addDayYMD(to,-363);
  const mon=weekStartYMD(from);
  const nWeeks=Math.floor((dayNum(to)-dayNum(mon))/7)+1;
  const W=22+nWeeks*(cell+gp), H=18+7*(cell+gp);
  const buckets=opts.buckets||[30,60,90];
  const lvl=v=>{ if(!(v>0)) return 0; if(v<buckets[0]) return 1; if(v<buckets[1]) return 2; if(v<buckets[2]) return 3; return 4; };
  const OP=[0,.28,.5,.74,1];
  let g='', lastMonth=-1;
  for(let w=0;w<nWeeks;w++){
    const wStart=addDayYMD(mon,w*7);
    const m=parseYMD(wStart).getMonth();
    if(m!==lastMonth){ lastMonth=m; g+='<text class="hm-lbl" x="'+(22+w*(cell+gp))+'" y="10">'+esc(MOIS3[m])+'</text>'; }
    for(let r=0;r<7;r++){
      const d=addDayYMD(mon,w*7+r);
      if(d>to&&!(opts.planned&&opts.planned[d])) { if(d>to) continue; }
      const x=22+w*(cell+gp), y=18+r*(cell+gp);
      const v=days[d]||0, L=lvl(v);
      if(v>0){
        g+='<rect x="'+x+'" y="'+y+'" width="'+cell+'" height="'+cell+'" rx="3" fill="'+color+'" fill-opacity="'+OP[L]+'" data-act="'+(opts.onDay||'hm-day')+'" data-date="'+d+'"/>';
      } else if(opts.planned&&opts.planned[d]){
        g+='<rect x="'+x+'" y="'+y+'" width="'+cell+'" height="'+cell+'" rx="3" fill="none" stroke="'+color+'" stroke-dasharray="2 2" stroke-opacity=".6" data-act="'+(opts.onDay||'hm-day')+'" data-date="'+d+'"/>';
      } else {
        g+='<rect x="'+x+'" y="'+y+'" width="'+cell+'" height="'+cell+'" rx="3" fill="var(--bg-3)" fill-opacity=".7" data-act="'+(opts.onDay||'hm-day')+'" data-date="'+d+'"/>';
      }
      if(d===isoToday()) g+='<rect x="'+(x-.7)+'" y="'+(y-.7)+'" width="'+(cell+1.4)+'" height="'+(cell+1.4)+'" rx="3.5" fill="none" stroke="var(--acc)" stroke-width="1.4"/>';
    }
  }
  [0,2,4].forEach(r=>{ g+='<text class="hm-lbl" x="0" y="'+(18+r*(cell+gp)+cell-2)+'">'+JOURS_MIN[[1,3,5][[0,2,4].indexOf(r)]]+'</text>'; });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'">'+g+'</svg>';
}

/** parts : [{label,v,color}] */
function donutChart(parts,opts){
  opts=opts||{};
  const size=opts.size||168, stroke=opts.stroke||24, R=(size-stroke)/2, C=2*Math.PI*R;
  const total=parts.reduce((s,p)=>s+Math.max(0,p.v||0),0)||1;
  let off=0, segs='';
  parts.forEach(p=>{ const len=Math.max(0,p.v||0)/total*C;
    segs+='<circle cx="'+size/2+'" cy="'+size/2+'" r="'+R+'" fill="none" stroke="'+p.color+'" stroke-width="'+stroke
      +'" stroke-dasharray="'+r1(len)+' '+r1(C-len)+'" stroke-dashoffset="'+r1(-off)+'"/>';
    off+=len; });
  return '<div class="goal-ring" style="width:'+size+'px;height:'+size+'px;margin:0 auto">'
    +'<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" class="ring">'
    +'<circle cx="'+size/2+'" cy="'+size/2+'" r="'+R+'" fill="none" stroke="var(--ring-track)" stroke-width="'+stroke+'"/>'+segs+'</svg>'
    +(opts.center?'<div class="ring-center">'+opts.center+'</div>':'')+'</div>';
}

/** Mini-courbe sans axes (carte d'accueil). */
function sparkline(points,opts){
  opts=opts||{};
  const W=opts.w||490, H=opts.h||CH_SPARK_H, pad=4;
  if(!points||points.length<2) return '';
  const from=opts.from||points[0].date, to=opts.to||points[points.length-1].date;
  const span=Math.max(1,dayNum(to)-dayNum(from));
  let mn=Infinity,mx=-Infinity; points.forEach(p=>{ if(p.v<mn) mn=p.v; if(p.v>mx) mx=p.v; });
  if(opts.goal!=null&&isNum(opts.goal)){ mn=Math.min(mn,opts.goal); mx=Math.max(mx,opts.goal); }
  if(mx===mn){ mx=mn+1; mn=mn-1; }
  const X=d=>pad+((dayNum(d)-dayNum(from))/span)*(W-2*pad);
  const Y=v=>pad+(1-(v-mn)/(mx-mn))*(H-2*pad);
  const gap=(state.ui&&state.ui.charts&&state.ui.charts.gapDays)||2;
  const d=pathLine(points,X,Y,gap), br=pathBridges(points,X,Y,gap);
  const gid='sp'+(++CHART_SEQ);
  const last=points[points.length-1];
  let area='', run=[];
  const flush=()=>{ if(run.length>1){ area+='M'+r1(X(run[0].date))+' '+H;
      run.forEach(p=>{ area+='L'+r1(X(p.date))+' '+r1(Y(p.v)); });
      area+='L'+r1(X(run[run.length-1].date))+' '+H+'Z'; } run=[]; };
  points.forEach((p,i)=>{ if(i&&dayNum(p.date)-dayNum(points[i-1].date)>gap) flush(); run.push(p); }); flush();
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" preserveAspectRatio="none" aria-hidden="true">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="'+(opts.color||'var(--acc)')+'" stop-opacity=".24"/>'
    +'<stop offset="100%" stop-color="'+(opts.color||'var(--acc)')+'" stop-opacity="0"/></linearGradient></defs>'
    +(area?'<path d="'+area+'" fill="url(#'+gid+')"/>':'')
    +(opts.goal!=null&&isNum(opts.goal)?'<line x1="0" y1="'+r1(Y(opts.goal))+'" x2="'+W+'" y2="'+r1(Y(opts.goal))+'" stroke="var(--m-goal)" stroke-dasharray="4 4" stroke-width="1" opacity=".7"/>':'')
    +(br?'<path d="'+br+'" fill="none" stroke="'+(opts.color||'var(--acc)')+'" stroke-width="1.6" stroke-dasharray="2 4" opacity=".4"/>':'')
    +'<path d="'+d+'" fill="none" stroke="'+(opts.color||'var(--acc)')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    +'<circle cx="'+r1(X(last.date))+'" cy="'+r1(Y(last.v))+'" r="3" fill="'+(opts.color||'var(--acc)')+'"/></svg>';
}

/* ---------- Scrubber tactile ---------- */
function wireScrub(host,id){
  const meta=CHART_META[id]; if(!meta||!meta.dates.length) return;
  const svg=host.querySelector('svg'); if(!svg) return;
  const hit=svg.querySelector('.chart-hit'); if(!hit) return;
  let cur=-1;
  function locate(clientX){
    const r=svg.getBoundingClientRect();
    const sx=(clientX-r.left)*(meta.w/((r.width||meta.w)));
    let best=0,bd=1e9;
    for(let i=0;i<meta.xs.length;i++){ const d=Math.abs(meta.xs[i]-sx); if(d<bd){ bd=d; best=i; } }
    return best;
  }
  function show(i){ if(i===cur||i<0) return; cur=i; paintCursor(svg,meta,i); haptic(6); }
  if(window.PointerEvent){
    hit.addEventListener('pointerdown',e=>{ try{ hit.setPointerCapture(e.pointerId); }catch(_){} show(locate(e.clientX)); });
    hit.addEventListener('pointermove',e=>{ if(e.buttons===0&&e.pointerType==='mouse') return; show(locate(e.clientX)); });
  } else {
    let x0=0,y0=0,mode=null;
    hit.addEventListener('touchstart',e=>{ const t=e.touches[0]; x0=t.clientX; y0=t.clientY; mode=null; show(locate(t.clientX)); },{passive:true});
    hit.addEventListener('touchmove',e=>{ const t=e.touches[0];
      if(mode===null){ const dx=Math.abs(t.clientX-x0),dy=Math.abs(t.clientY-y0); if(dx<4&&dy<4) return; mode=dx>dy?'scrub':'scroll'; }
      if(mode!=='scrub') return; e.preventDefault(); show(locate(t.clientX)); },{passive:false});
    hit.addEventListener('touchend',()=>{ mode=null; },{passive:true});
  }
}
function paintCursor(svg,meta,i){
  const x=meta.xs[i], date=meta.dates[i];
  const ln=svg.querySelector('.cursor-line');
  if(ln){ ln.setAttribute('x1',x); ln.setAttribute('x2',x); ln.style.display=''; }
  meta.series.forEach((s,k)=>{
    const dot=svg.querySelector('.cursor-dot[data-s="'+k+'"]'); if(!dot) return;
    const v=s.byDate[date];
    if(v==null){ dot.style.display='none'; return; }
    dot.style.display=''; dot.setAttribute('cx',x); dot.setAttribute('cy',r1(s.Y(v)));
  });
  const ro=meta.readoutId?document.getElementById(meta.readoutId):null;
  if(ro) ro.innerHTML=readoutHTML(meta,i);
}
function readoutHTML(meta,i){
  const date=meta.dates[i];
  let h='<span class="ro-date">'+esc(capit(parseYMD(date).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})))+'</span>';
  let any=false;
  meta.series.forEach(s=>{
    const v=s.byDate[date]; if(v==null) return; any=true;
    h+='<span class="'+(s.axis==='right'?'ro-x':'ro-v')+'" style="color:'+s.color+'">'+esc(nf(v,s.dec))+(s.unit?'<span class="ro-u">'+NBSP+esc(s.unit)+'</span>':'')+'</span>';
  });
  if(!any) h+='<span class="ro-none">pas de donnée</span>';
  return h;
}
function animateChart(el){
  qa('path.ln-raw',el).forEach(p=>{
    let L=0; try{ L=p.getTotalLength(); }catch(e){ return; }
    if(!L||L>20000) return;
    p.style.strokeDasharray=L; p.style.strokeDashoffset=L;
    requestAnimationFrame(()=>{ p.style.transition='stroke-dashoffset .75s cubic-bezier(.16,1,.3,1)'; p.style.strokeDashoffset=0; });
  });
  qa('g.bars-in',el).forEach(g=>{ requestAnimationFrame(()=>g.classList.add('on')); });
}

/* ============================================================
   RENDU
   ============================================================ */
const view=document.getElementById('view');
function currentRoute(){ return decodeURIComponent(location.hash.replace(/^#/,''))||'/'; }
function nav(r){ location.hash='#'+r; }

let LAST_ROUTE=null;
function render(){
  CHART_QUEUE=[];
  const r=currentRoute(); const seg=r.split('/');
  let html='';
  try{ html=routeHTML(r,seg); }
  catch(e){ html='<div class="card"><div class="row-title">Oups</div><div class="small muted" style="margin-top:6px">'+esc(String(e&&e.message||e))+'</div></div>'; }
  const changed=r!==LAST_ROUTE;
  view.innerHTML='<div class="screen'+(changed?'':' no-anim')+'">'+updateBanner()+storageBanner()+html+'</div>';
  if(changed) window.scrollTo(0,0);
  LAST_ROUTE=r;
  postRender(r,changed);
  updateTabs(r);
}
window.addEventListener('hashchange',render);

/* ---------- Routeur ---------- */
function routeHTML(r,seg){
  if(r==='/'||r==='') return screenHome();
  if(r==='/courbes') return screenCourbes();
  if(r==='/tableau') return screenTableau();
  if(r==='/plus') return screenPlus();
  if(r==='/objectif') return screenObjectif();
  if(r==='/paliers') return screenPaliers();
  if(r==='/motivations') return screenMotivations();
  if(r==='/analyse') return screenAnalyse();
  if(r==='/semaine') return screenSemaine();
  if(r==='/mensurations') return screenMensurations();
  if(r==='/simulateur') return screenSimulateur();
  if(r==='/astuces') return screenAstuces();
  if(r==='/sport') return screenSport('seances');
  if(r==='/planning') return screenSport('planning');
  if(r==='/activites') return screenSport('activites');
  if(r==='/pilulier') return screenPillbox();
  if(seg[1]==='produit'&&seg[2]) return screenMedDetail(seg[2]);
  if(r==='/calories') return screenCalories();
  if(r==='/sauvegarde') return screenBackup();
  if(r==='/reglages') return screenSettings();
  if(r==='/metriques') return screenMetrics();
  if(r==='/aide') return screenAide();
  return screenHome();
}
/* L'onglet allumé doit correspondre à l'endroit où ramène le bouton « Retour » :
   Analyse et Calories s'ouvrent depuis Plus, c'est donc Plus qui s'allume. */
const TAB_COURBES=['/courbes'];
const TAB_PLUS=['/plus','/objectif','/paliers','/motivations','/sport','/planning','/activites',
  '/pilulier','/sauvegarde','/reglages','/metriques','/aide','/analyse','/calories','/simulateur','/astuces',
  '/semaine','/mensurations'];
function tabOf(r){
  if(TAB_COURBES.indexOf(r)>=0) return '/courbes';
  if(r==='/tableau') return '/tableau';
  if(TAB_PLUS.indexOf(r)>=0||r.indexOf('/produit/')===0) return '/plus';
  return '/';                                  // accueil, et tout ce qu'on ne reconnaît pas
}

/* ============================================================
   SAISIE DE LA PESÉE
   ------------------------------------------------------------
   Chaque métrique de composition a DEUX champs : un en %, un en
   kg. On saisit celui qu'on veut, l'autre se calcule en direct
   à partir du poids en cours de saisie. Le champ dérivé est
   grisé et en pointillés : on voit tout de suite lequel fait foi.
   ============================================================ */
let WI=null;        // brouillon de saisie {date, m:{key:{v,u}}, note}
let WI_RETOUR=null; // date de la pesée quittée pour aller cocher une mesure (cf. go-metrics)

function openWeighIn(date,focusKey){
  WI_RETOUR=null;
  date=validYMD(date)?date:isoToday();
  const e=entryFor(date);
  WI={date:date, m:{}, note:e?(e.note||''):'', existed:!!e};
  if(e) for(const k in e.m) WI.m[k]=Object.assign({},e.m[k]);
  openSheet(wiTitle(),wiBody(),{onOpen:()=>{ wiFill(); wiRecompute(); wiFocus(focusKey); },onClose:wiAutoSave});
}
function wiTitle(){ return 'Pesée — '+capit(fmtDayLabel(WI.date)); }
/* Le brouillon survit à un aller-retour vers les réglages : on le rouvre tel quel. */
function wiHasDraft(){ return !!(WI&&WI.m&&Object.keys(WI.m).length); }
function resumeWeighIn(){
  if(!wiHasDraft()) return openWeighIn(isoToday());
  openSheet(wiTitle(),wiBody(),{onOpen:()=>{ wiFill(); wiRecompute(); },onClose:wiAutoSave});
}
/* Enregistrement silencieux à la fermeture : on ne repose aucune question ici
   (les contrôles de plausibilité restent sur le bouton « Enregistrer »). */
function wiAutoSave(){
  if(!WI) return;
  const note=(document.getElementById('wiNote')||{}).value;
  const before=JSON.stringify((entryFor(WI.date)||{m:{}}).m);
  const after=JSON.stringify(WI.m);
  const noteBefore=((entryFor(WI.date)||{}).note)||'';
  if(before===after&&String(note||'')===String(noteBefore)){ WI=null; return; }
  const e=ensureEntry(WI.date);
  e.m={}; for(const k in WI.m) if(WI.m[k]&&WI.m[k].v!=null) e.m[k]=Object.assign({},WI.m[k]);
  e.note=(note||'').trim()||null;
  e.updatedAt=new Date().toISOString();
  const vide=entryIsEmpty(e);
  if(vide) deleteEntry(WI.date); else delete (state.ui.skippedDays||{})[WI.date];
  const d=WI.date; WI=null;
  update();
  if(!vide) toast('Pesée du '+fmtDateShort(d)+' enregistrée ✓');
}
/* Le curseur va là où il y a quelque chose à taper. Depuis l'écran Calories, c'est la
   case des calories — pas celle du poids, déjà remplie ce matin-là. */
function wiFocus(key){
  const el=document.getElementById('mi-'+(key||'weight')+'-val');
  if(!el) return;
  if(key||!el.value) try{ el.focus(); if(key&&el.value) el.select(); }catch(e){}
  if(key&&el.scrollIntoView) try{ el.scrollIntoView({block:'center'}); }catch(e){}
}
function wiBody(){
  const list=activeMetrics();
  let h='<div class="field"><label>Date</label>'
    +'<input class="input" type="date" id="wiDate" value="'+WI.date+'" max="'+isoToday()+'">'
    +'<div class="chip-row" style="margin-top:8px">'
    + [[0,"Aujourd'hui"],[-1,'Hier'],[-2,'Avant-hier']].map(o=>{
        const d=addDayYMD(isoToday(),o[0]);
        return '<button class="chip'+(WI.date===d?' is-active':'')+'" data-act="wi-day" data-d="'+o[0]+'">'+esc(o[1])+'</button>'; }).join('')
    +'</div></div>';

  h+='<div class="section-title" style="margin-top:16px">Ce que dit la balance</div>';
  list.forEach(k=>{ h+=wiField(k); });

  h+='<div class="field"><label>Note (facultatif)</label>'
    +'<textarea class="input" id="wiNote" placeholder="Ex. : resto hier soir, mal dormi, séance de jambes…">'+esc(WI.note||'')+'</textarea></div>';
  h+='<button class="btn-add" data-act="go-metrics">'+ic('settings','ic--sm')+'Choisir les mesures affichées</button>';

  h+='<div class="sheet-foot">'
    +'<button class="btn btn--primary btn--block btn--lg" data-act="wi-save">Enregistrer</button>'
    +(WI.existed?'<button class="btn btn--danger btn--block" data-act="wi-delete" style="margin-top:8px">Supprimer cette pesée</button>':'')
    +'</div>';
  return h;
}
function wiField(k){
  const M=METRICS[k];
  const prev=wiPrevEntry();
  let h='<div class="mfield" id="mrow-'+k+'"><div class="mfield-head">'
    +'<div class="mfield-ic" style="color:'+M.color+'">'+ic(M.icon)+'</div>'
    +'<div class="mfield-name">'+esc(M.label)+'</div>'
    +'<div class="mfield-delta" id="mdelta-'+k+'"></div></div>';
  if(M.kind==='comp'){
    h+='<div class="mfield-inputs">'
      +'<div class="dual" id="dual-'+k+'-pct"><input class="input" id="mi-'+k+'-pct" data-mi="'+k+'" data-u="pct" inputmode="decimal" autocomplete="off" placeholder="—"><span class="dual-unit">%</span></div>'
      +'<div class="dual" id="dual-'+k+'-kg"><input class="input" id="mi-'+k+'-kg" data-mi="'+k+'" data-u="kg" inputmode="decimal" autocomplete="off" placeholder="—"><span class="dual-unit">kg</span></div>'
      +'</div>';
  } else {
    /* Métrique simple : un seul champ. L'identifiant ne dépend PAS de l'unité
       (certaines contiennent « / » ou sont vides). */
    const u=M.unit||'';
    h+='<div class="mfield-inputs single">'
      +'<div class="dual" id="dual-'+k+'-val"><input class="input" id="mi-'+k+'-val" data-mi="'+k+'" data-u="'+esc(u)+'" inputmode="decimal" autocomplete="off" placeholder="—"><span class="dual-unit">'+esc(u)+'</span></div>'
      +'</div>';
  }
  h+='<div class="mfield-foot" id="mfoot-'+k+'"></div></div>';
  return h;
}
/* Pesée précédente (pour afficher l'écart en direct). */
function wiPrevEntry(){
  let best=null;
  for(const e of state.entries){ if(e.date<WI.date&&(!best||e.date>best.date)) best=e; }
  return best;
}
/* Poids actuellement dans le FORMULAIRE (pas dans le store : il est peut-être en cours de frappe). */
function wiWeightKg(){
  const el=document.getElementById('mi-weight-val');
  if(el){ const v=parseNum(el.value); if(v!=null) return v; }
  const raw=WI.m.weight; return raw&&raw.v!=null?raw.v:null;
}
/* Remplit les champs à partir du brouillon. Appelée UNE fois à l'ouverture (ou après
   un changement de date), jamais pendant la frappe : sinon vider un champ le
   re-remplirait aussitôt. */
function wiFill(){
  activeMetrics().forEach(k=>{
    const M=METRICS[k], src=WI.m[k];
    if(!src||src.v==null) return;
    const el=document.getElementById(M.kind==='comp'?('mi-'+k+'-'+src.u):('mi-'+k+'-val'));
    if(el) el.value=nf(src.v,metricDec(k,M.kind==='comp'?src.u:null));
  });
}
/* Recalcule les champs DÉRIVÉS, les libellés d'aide et les écarts. Appelée à chaque frappe. */
function wiRecompute(changedKey){
  const W=wiWeightKg(), prev=wiPrevEntry();
  activeMetrics().forEach(k=>{
    const M=METRICS[k], src=WI.m[k];
    if(M.kind==='comp'){
      const other=(src&&src.u==='kg')?'pct':'kg';
      const elOther=document.getElementById('mi-'+k+'-'+other);
      const dSrc=document.getElementById('dual-'+k+'-'+(src?src.u:M.defUnit));
      const dOther=document.getElementById('dual-'+k+'-'+other);
      if(dSrc){ dSrc.classList.toggle('is-source',!!src); dSrc.classList.remove('is-derived'); }
      if(dOther){ dOther.classList.toggle('is-derived',!!src); dOther.classList.remove('is-source'); }
      if(elOther){
        if(!src){ if(document.activeElement!==elOther) elOther.value=''; }
        else{
          const conv=convertMetric(src.v,src.u,other,W);
          elOther.value = conv==null?'' : nf(conv,metricDec(k,other));
        }
      }
      /* Le pied de champ montre le calcul, en toutes lettres. */
      const foot=document.getElementById('mfoot-'+k);
      if(foot){
        if(!src) foot.textContent='';
        else if(W==null) foot.textContent='Saisis d’abord ton poids pour convertir en '+(src.u==='kg'?'%':'kg')+'.';
        else if(src.u==='pct') foot.textContent=nf(src.v,1)+' % de '+nf(W,1)+' kg = '+nf(W*src.v/100,2)+' kg';
        else foot.textContent=nf(src.v,2)+' kg sur '+nf(W,1)+' kg = '+nf(src.v/W*100,1)+' %';
      }
    }
    /* Écart avec la pesée précédente, en direct. */
    const dEl=document.getElementById('mdelta-'+k);
    if(dEl){
      const cur=WI.m[k], u=cur?cur.u:metricUnit(k);
      const pv=prev?mv(prev,k,u):null;
      if(cur&&pv!=null){
        const d=cur.v-pv;
        const cls=deltaClass(d,METRICS[k].better==='up'?1:(METRICS[k].better==='down'?-1:0));
        dEl.className='mfield-delta '+(METRICS[k].better==='flat'?'delta--flat':cls);
        dEl.textContent=(Math.abs(d)<0.005?'=':((d>0?'+':MINUS)+nf(Math.abs(d),metricDec(k,u))))+' '+unitLabel(k,u);
      } else dEl.textContent='';
    }
    const row=document.getElementById('mrow-'+k);
    if(row) row.classList.toggle('is-filled',!!WI.m[k]);
  });
}
/* Saisie dans un champ : on note la valeur ET son unité, puis on recalcule. */
function wiInput(el){
  const k=el.dataset.mi, u=el.dataset.u||defaultUnitOf(k);
  const v=parseNum(el.value);
  if(v==null) delete WI.m[k]; else WI.m[k]={v:v,u:u};
  wiRecompute(k);
}
function wiSetDate(d){
  if(!validYMD(d)) return;
  WI.date=d; const e=entryFor(d);
  WI.m={}; WI.note=e?(e.note||''):''; WI.existed=!!e;
  if(e) for(const k in e.m) WI.m[k]=Object.assign({},e.m[k]);
  setSheetTitle(wiTitle());
  refreshSheet(wiBody());
  wiFill(); wiRecompute();
}
function saveWeighIn(){
  const note=(document.getElementById('wiNote')||{}).value;
  const w=WI.m.weight?WI.m.weight.v:null;
  const M=METRICS.weight;
  if(w!=null&&(w<M.min||w>M.max)){ toast('Un poids de '+nf(w,1)+' kg ? Vérifie le chiffre.'); return; }
  const doSave=()=>{
    SHEET_CLOSE=null;                      // l'enregistrement explicite prend la main
    const e=ensureEntry(WI.date);
    e.m={};
    for(const k in WI.m) if(WI.m[k]&&WI.m[k].v!=null) e.m[k]=Object.assign({},WI.m[k]);
    e.note=(note||'').trim()||null;
    e.updatedAt=new Date().toISOString();
    const wasEmpty=entryIsEmpty(e);
    if(wasEmpty) deleteEntry(WI.date);
    delete (state.ui.skippedDays||{})[WI.date];
    closeSheet(); haptic(15); update();
    if(wasEmpty){ toast('Pesée vide — rien à enregistrer'); return; }
    toast(WI.existed?'Pesée mise à jour ✓':'Pesée enregistrée ✓');
    setTimeout(()=>checkMilestones({celebrate:true}),450);
  };
  /* Contrôle doux de plausibilité sur TOUTES les métriques : on demande, on ne bloque jamais. */
  const douteux=[];
  for(const k in WI.m){
    const x=WI.m[k], M=METRICS[k]; if(!x||x.v==null||!M) continue;
    const rg=metricRange(k,x.u);
    if(rg.min!=null&&rg.max!=null&&(x.v<rg.min||x.v>rg.max))
      douteux.push(M.label+' : '+fmtMetric(x.v,k,x.u));
  }
  const o=(w!=null)?isOutlierInput(w,WI.date):{suspect:false};
  if(douteux.length){
    confirmSheet('Vérification',
      (douteux.length===1?'Cette valeur sort des ordres de grandeur habituels — '
                         :'Ces valeurs sortent des ordres de grandeur habituels — ')
      +douteux.join(' · ')+'. C’est peut-être une faute de frappe. Tu confirmes ?',
      doSave,false,'Oui, c’est bien ça',wiAutoSave);
    return;
  }
  if(o.suspect){ confirmSheet('Vérification',o.text,doSave,false,'Oui, c’est bien ça',wiAutoSave); return; }
  doSave();
}
function deleteWeighIn(){
  const d=WI.date; SHEET_CLOSE=null; WI=null;
  confirmSheet('Supprimer la pesée','La pesée du '+fmtDateLong(d)+' sera supprimée. Continuer ?',()=>{
    const e=deleteEntry(d); if(!e) return;
    update();
    toast('Pesée supprimée',()=>{ state.entries.push(e); state.entries.sort((a,b)=>a.date<b.date?-1:1); update(); });
  },true,'Supprimer');
}

/* ============================================================
   ÉCRAN : ACCUEIL
   ------------------------------------------------------------
   Séquence mentale du matin : « j'ai fait ma pesée ? » →
   « ça donne quoi ? » → « qu'est-ce qui m'attend aujourd'hui ? »
   → « où j'en suis ? ». Le « pourquoi » ferme l'écran : on quitte
   l'app sur une note chaleureuse, pas sur un chiffre.
   ============================================================ */
function screenHome(){
  if(!hasProfile()) return screenOnboarding();
  let h=homeHead();
  h+=homeStatus();
  h+=homeHero();
  h+=homeDay();
  const prog=homeGoal()+homeMilestone()+homeStats();
  if(prog) h+='<div class="section-title">Ta progression</div>'+prog;
  h+=homeInsight();
  h+=homeWhy();
  h+=homeBackup();
  return h;
}
/* Quatorze pastilles : une par jour, pesé ou non. C'est la vue la plus courte qui
   donne envie de ne pas casser la ligne — et elle tient sur une ligne. */
function homeDots(){
  const t=isoToday(), sk=state.ui.skippedDays||{};
  let h='<div class="daydots" aria-label="Tes quatorze derniers jours">';
  for(let i=13;i>=0;i--){
    const d=addDayYMD(t,-i);
    const has=mv(entryFor(d),'weight')!=null;
    const cls=has?'on':(d===t?'today':(sk[d]?'skip':'off'));
    const lab=capit(parseYMD(d).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'}));
    h+='<button class="daydot '+cls+'" data-act="weigh-in" data-date="'+d+'" aria-label="'+esc(lab)+(has?' — pesé':' — pas de pesée')+'"></button>';
  }
  return h+'</div>';
}
function homeHead(){
  const n=state.settings.profile.firstName;
  return '<div class="screen-head"><div>'
    +'<h1 class="screen-title">'+esc(greeting())+(n?' '+esc(n):'')+'</h1>'
    +'<div class="screen-sub">'+esc(capit(fmtDateFull(isoToday())))+'</div></div>'
    +'<button class="btn btn--ghost icon-btn" data-act="go" data-route="/reglages" aria-label="Réglages">'+ic('settings')+'</button></div>';
}

/* ---------- Bloc A : l'état du jour ---------- */
function homeStatus(){
  let h='';
  if((state.ui.skippedDays||{})[isoToday()]) h+=statusSkipped();
  else if(hasWeightToday()) h+=statusDone();
  else h+=statusTodo();
  h+=statusCatchUp();
  return h;
}
function weighNudge(){
  const h=new Date().getHours();
  if(h<10) return 'Trente secondes et c’est réglé.';
  if(h<14) return 'Le chiffre de ce matin, si tu l’as encore en tête.';
  if(h<20) return 'Tu peux toujours noter la pesée de ce matin.';
  return 'Ou on se voit demain, tout simplement.';
}
function statusTodo(){
  const s=streakInfo(), hr=new Date().getHours();
  let h='<div class="card card--action"><div class="today-top">'
   +'<div class="today-ic is-acc">'+ic('scale')+'</div>'
   +'<div class="row-main"><div class="row-title" style="white-space:normal">'+esc(hr<12?'Pas encore pesé ce matin':'Pas de pesée aujourd’hui')+'</div>'
   +'<div class="small muted">'+esc(weighNudge())+'</div></div></div>'
   +'<button class="btn btn--primary btn--block btn--lg" data-act="weigh-in" style="margin-top:12px">'
   +ic('scale')+(hr<14?'Peser ce matin':'Noter ma pesée')+'</button>';
  if(hr>=20) h+='<button class="btn btn--ghost btn--block" data-act="skip-today" style="margin-top:8px">Passer mon tour aujourd’hui</button>';
  if(s.days>0) h+='<div class="streak-line">'+ic('bolt','ic--sm')+'<b>'+s.days+' '+plural(s.days,'jour')+' de suite</b>'
   +(s.jokers?' <span class="muted small">(1 joker utilisé)</span>':'')+'</div>';
  if(weighIns().length>1) h+=homeDots();
  return h+'</div>';
}
const DONE_TITLES=['Pesée du jour enregistrée','C’est noté pour aujourd’hui','Fait. Un jour de plus au compteur',
  'Enregistré — merci pour la régularité','Ça, c’est fait ✓','Ta pesée du matin est dans la boîte'];
function statusDone(){
  const e=entryFor(isoToday()), s=streakInfo(), best=bestStreakDays();
  const t=e.updatedAt?new Date(e.updatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):null;
  let h='<div class="card"><div class="today-top">'
   +'<div class="today-ic is-done">'+ic('check')+'</div>'
   +'<div class="row-main"><div class="row-title" style="white-space:normal">'+esc(DONE_TITLES[dayIndex()%DONE_TITLES.length])+'</div>'
   +'<div class="small muted">'+fmtKg(mv(e,'weight'))+(t?' · noté à '+t:'')+'</div></div>'
   +'<button class="btn-add" data-act="weigh-in">Modifier</button></div>';
  if(isOutlier(e)) h+='<div class="small muted" style="margin-top:10px">Ce chiffre est un peu à part par rapport à ta tendance — sel, sport de la veille, mauvais sommeil : c’est normal. La tendance, elle, ne bouge presque pas.</div>';
  h+='<div class="streak-line">'+ic('bolt','ic--sm')+'<b>'+s.days+' '+plural(s.days,'jour')+' de suite</b>'
   +(best>s.days?' <span class="muted small">· record '+best+'</span>':' <span class="muted small">· c’est ton record</span>')+'</div>';
  if(weighIns().length>1) h+=homeDots();
  return h+'</div>';
}
function statusSkipped(){
  return '<div class="card"><div class="today-top">'
   +'<div class="today-ic">'+ic('moon')+'</div>'
   +'<div class="row-main"><div class="row-title">Journée sans pesée. À demain.</div>'
   +'<div class="small muted">Ta série est préservée.</div></div>'
   +'<button class="btn-add" data-act="unskip-today">Finalement…</button></div></div>';
}
function statusCatchUp(){
  const miss=missingDaysIn(8);
  if(!miss.length||weighIns().length<3) return '';
  return '<div class="card" style="margin-top:10px">'
   +'<div class="row-title">'+(miss.length===1?'Il manque un jour cette semaine':'Il manque '+miss.length+' jours cette semaine')+'</div>'
   +'<div class="small muted" style="margin-top:3px">'+esc(miss.length>3
      ?'Aucun souci — on repart d’ici. Les trous ne faussent pas ta tendance.'
      :'Si tu as encore les chiffres, tu peux les ajouter. Sinon, on continue tranquillement.')+'</div>'
   +'<div class="chip-wrap" style="margin-top:10px">'
   +miss.slice(-4).map(d=>'<button class="chip chip--act" data-act="weigh-in" data-date="'+d+'">'
      +esc(capit(parseYMD(d).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'})))+'</button>').join('')
   +'</div></div>';
}

/* ---------- Bloc B : le chiffre hero ----------
   Le hero affiche le POIDS BRUT (celui qu'il vient de lire sur sa balance :
   s'il ne le retrouve pas, il perd confiance dans l'app), et la TENDANCE
   juste dessous. Les variations, elles, sont calculées sur la tendance —
   c'est la seule façon de ne pas peindre en rouge un lundi matin salé. */
function homeHero(){
  const l=lastWeighIn(); if(!l) return '';
  const all=weighIns();
  const raw=mv(l,'weight'), tr=trendNow();
  const mode=(state.settings.heroMode==='trend'&&tr!=null)?'trend':'raw';
  const big=(mode==='trend')?tr:raw;
  const prev=all.length>1?mv(all[all.length-2],'weight'):big;
  const d1=all.length>1?Math.round((raw-prev)*100)/100:null;
  const t7=trendAt(addDayYMD(isoToday(),-7));
  const d7=(tr!=null&&t7!=null&&all.length>2)?Math.round((tr-t7)*100)/100:null;
  const lost=kgLost();
  const dAll=(lost!=null&&all.length>1)?-lost:null;
  const rate=bestRate();
  const stale=diffDays(l.date,isoToday());

  let h='<div class="card hero tap" data-act="go" data-route="/courbes">';
  h+='<div class="hero-label">'+(mode==='trend'?'Tendance lissée'
      :(stale===0?'Poids ce matin':'Dernière pesée · '+esc(fmtDateShort(l.date))))+'</div>';
  h+='<div class="hero-value tnum"><span data-count="'+big.toFixed(1)+'" data-dec="1">'+nf(big,1)+'</span><span class="hero-unit">kg</span></div>';
  if(tr!=null&&all.length>1)
    h+='<div class="hero-trend tap" data-act="toggle-hero">'
      +(mode==='trend'?'Balance : <b>'+fmtKg(raw)+'</b>':'Tendance : <b>'+fmtKg(tr)+'</b>')
      +(rate!=null?' · <span class="delta '+deltaClass(rate,-1)+'">'+fmtRate(rate)+'</span>':'')+' ›</div>';
  else
    h+='<div class="small muted" style="margin-top:6px">Voilà ton point de départ. Reviens demain matin : c’est à partir de la deuxième pesée que ça devient intéressant.</div>';
  h+=homeSpark();
  if(all.length>1){
    h+='<div class="stats" style="margin-top:12px">'
     +statCard('Depuis hier',d1==null?'—':sgnKg(d1),(d1!=null&&Math.abs(d1)>0.6)?'surtout de l’eau':'','delta--flat')
     +statCard('7 jours',d7==null?'—':sgnKg(d7),d7==null?'encore un peu de patience':'',deltaClass(d7,-1))
     +statCard('Au total',dAll==null?'—':sgnKg(dAll),(dAll!=null&&dAll<0)?(equivShort(-dAll)||''):'',deltaClass(dAll,-1))
     +'</div>';
  }
  if(stale>=3) h+='<div class="small muted" style="margin-top:10px">Dernière pesée il y a '+stale+' jours. Content de te revoir.</div>';
  return h+'</div>';
}
function homeSpark(){
  const s=trendSeries(); if(s.length<2) return '';
  const days=state.settings.sparkDays||60;
  const from=addDayYMD(isoToday(),-(days-1));
  let p=s.filter(x=>x.date>=from);
  if(p.length<2) p=s.slice(-2);
  const pts=p.map(x=>({date:x.date,v:x.trend}));
  const raws=p.map(x=>({date:x.date,v:x.raw}));
  const tg=targetWeight();
  return chartSlot(w=>sparkHome(w,pts,raws,tg),{h:CH_SPARK_H+8,scrub:false});
}
function sparkHome(W,pts,raws,goal){
  const H=CH_SPARK_H, pad=5;
  const from=pts[0].date, to=pts[pts.length-1].date;
  const span=Math.max(1,dayNum(to)-dayNum(from));
  let mn=Infinity,mx=-Infinity;
  pts.concat(raws).forEach(p=>{ if(p.v<mn) mn=p.v; if(p.v>mx) mx=p.v; });
  let showG=goal!=null&&goal>mn-3&&goal<mx+3;
  if(showG){ mn=Math.min(mn,goal); mx=Math.max(mx,goal); }
  const p2=Math.max(0.4,(mx-mn)*0.12); mn-=p2; mx+=p2;
  const X=d=>pad+((dayNum(d)-dayNum(from))/span)*(W-2*pad);
  const Y=v=>pad+(1-(v-mn)/Math.max(0.001,mx-mn))*(H-2*pad);
  const line=pts.map((x,i)=>(i?'L':'M')+r1(X(x.date))+' '+r1(Y(x.v))).join('');
  const area=line+'L'+r1(X(pts[pts.length-1].date))+' '+H+'L'+r1(X(pts[0].date))+' '+H+'Z';
  const dots=raws.map(x=>'<circle cx="'+r1(X(x.date))+'" cy="'+r1(Y(x.v))+'" r="1.6" class="spark-dot"/>').join('');
  const last=pts[pts.length-1];
  const gid='hs'+(++CHART_SEQ);
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" aria-hidden="true">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="var(--acc)" stop-opacity=".26"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs>'
    +'<path d="'+area+'" fill="url(#'+gid+')"/>'
    +(showG?'<line x1="0" y1="'+r1(Y(goal))+'" x2="'+W+'" y2="'+r1(Y(goal))+'" class="spark-goal"/>':'')
    +dots
    +'<path d="'+line+'" class="spark-line" vector-effect="non-scaling-stroke"/>'
    +'<circle cx="'+r1(X(last.date))+'" cy="'+r1(Y(last.v))+'" r="3.2" class="spark-head"/></svg>';
}

/* ---------- Bloc C : ta journée ---------- */
function homeDay(){
  const a=homeAgenda(), m=homeMeds();
  if(!a&&!m) return '';
  return '<div class="section-title">Ta journée</div>'+a+m;
}
function homeAgenda(){
  if(!state.settings.modules.sport) return '';
  const plan=(typeof plannedToday==='function')?plannedToday():[];
  const done=(typeof sessionsOnDay==='function')?sessionsOnDay(isoToday()):[];
  if(!plan.length&&!done.length&&!state.settings.modules.planning) return '';
  const now=nowMin();
  let h='<div class="card"><div class="row-title flex aic gap8" style="margin-bottom:10px">'+ic('calendar','ic--sm')+'Aujourd’hui</div>';
  if(!plan.length&&!done.length){
    h+='<div class="small muted" style="margin:4px 0 10px">Rien de prévu aujourd’hui. Repos ou envie de bouger ?</div>';
  } else {
    h+='<div class="list">';
    plan.forEach(p=>{
      const did=done.some(s=>s.planKey===p.key);
      const late=!did&&p.time&&hhmmToMin(p.time)<now;
      h+='<div class="row row--wrap'+(did?' is-dim':'')+'">'
        +'<div class="row-ic row-ic--emoji">'+uem(p.emoji||'🏋️')+'</div>'
        +'<div class="row-main"><div class="row-title wrap">'+esc(p.label)+'</div>'
        +'<div class="row-sub">'+(p.time?'<span class="pill">'+esc(p.time)+'</span>':'')
        +(p.durationMin?'<span class="pill">'+fmtMin(p.durationMin)+'</span>':'')
        +(did?'<span class="badge badge--ok">fait ✓</span>':'')+'</div></div>'
        +(did?'':'<div class="med-acts"><button class="chip chip--act is-active" data-act="plan-done" data-key="'+esc(p.key)+'">C’est fait</button>'
              +(late?'<button class="chip chip--act" data-act="plan-skip" data-key="'+esc(p.key)+'">Pas ce soir</button>':'')+'</div>')
        +'</div>';
    });
    done.filter(s=>!s.planKey).forEach(s=>{
      h+='<div class="row"><div class="row-ic row-ic--emoji">'+uem(actEmoji(s.activityKey))+'</div>'
        +'<div class="row-main"><div class="row-title">'+esc(actLabel(s.activityKey))+'</div>'
        +'<div class="row-sub"><span class="pill">'+fmtMin(s.durationMin)+'</span><span class="badge badge--ok">fait ✓</span></div></div></div>';
    });
    h+='</div>';
    if(plan.length&&!done.length) h+='<div class="small muted" style="margin-top:8px">Prépare ton sac : '+esc(plan[0].label.toLowerCase())+(plan[0].time?' à '+esc(plan[0].time):'')+'. Tu seras content de l’avoir fait.</div>';
    if(done.length) h+='<div class="small muted" style="margin-top:8px">'+esc(SESSION_DONE[dayIndex()%SESSION_DONE.length])+'</div>';
  }
  h+='<button class="btn btn--ghost btn--block" data-act="new-session" style="margin-top:10px">+ Noter une séance</button>';
  return h+'</div>';
}
const SESSION_DONE=['Séance dans la poche.','Bien joué, c’est fait.','Une séance de plus au compteur.',
  'Ton corps te dira merci demain.','Voilà comment on avance.'];

function homeMeds(){
  if(!state.settings.modules.pillbox||!state.settings.pillbox.showOnHome) return '';
  if(typeof pillboxForDate!=='function') return '';
  if(!state.meds.some(m=>m.active&&!m.archived)) return '';
  const date=pillToday(), box=pillboxForDate(date);
  PILL_BOX=box;
  const nm=nowMin();
  const due=box.slots.filter(s=>!s.extra&&(s.status==='pending'||(s.status==='snoozed'&&s.snoozeMin!=null&&nm>=s.snoozeMin)));
  const na=box.notApplicable;
  const reportees=box.slots.filter(s=>!s.extra&&s.status==='snoozed').length;
  if(!due.length&&!na.length){
    if(!box.counts.expected) return '';
    if(reportees) return '<div class="card tap" data-act="go" data-route="/pilulier" style="display:flex;align-items:center;gap:12px;padding:12px 14px">'
      +'<div class="row-ic">'+ic('hourglass')+'</div><div class="row-main"><div class="row-title">'+reportees+' '+plural(reportees,'prise')+' '+plural(reportees,'reportée')+'</div>'
      +'<div class="row-sub">on t’en reparle plus tard</div></div>'+arrowHTML()+'</div>';
    return '<div class="card tap" data-act="go" data-route="/pilulier" style="display:flex;align-items:center;gap:12px;padding:12px 14px">'
      +'<div class="row-ic" style="color:var(--pos)">'+ic('check')+'</div>'
      +'<div class="row-main"><div class="row-title">Pilulier complet</div>'
      +'<div class="row-sub">'+box.counts.taken+' '+plural(box.counts.taken,'prise')+' sur '+box.counts.expected
      +(pillStreak()>1?' · série de '+pillStreak()+' jours':'')+'</div></div>'+arrowHTML()+'</div>';
  }
  const shown=due.slice(0,4), rest=due.length-shown.length;
  let h='<div class="card">'
    +'<div class="today-top" style="margin-bottom:10px"><div class="row-main"><div class="row-title flex aic gap8">'+ic('pill','ic--sm')+'Prises du jour</div></div>'
    +'<div class="small muted tnum">'+box.counts.taken+'/'+box.counts.expected+'</div></div><div class="list">';
  h+=shown.map(s=>pillSlotRow(s,true)).join('');
  h+='</div>';
  if(rest>0) h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/pilulier" style="margin-top:4px">Voir les '+rest+' autres</button>';
  if(na.length){
    h+='<div class="divider"></div><div class="small muted" style="margin-bottom:8px">'+(state.settings.modules.sport
      ?'Pas d’entraînement prévu aujourd’hui — ces prises ne te sont pas rappelées, mais tu peux les cocher si tu les as prises quand même.'
      :'Le module Sport est désactivé — ces prises ne te sont pas rappelées, mais tu peux les cocher si tu les as prises quand même.')+'</div>'
      +'<div class="chip-wrap">'
      +na.map(s=>'<button class="chip chip--act" data-act="pill-anyway" data-key="'+esc(s.key)+'">'+esc(s.product.name)+' · pris</button>').join('')
      +'</div>';
  }
  return h+'</div>';
}

/* ---------- Bloc D : progression vers l'objectif ---------- */
function homeGoal(){
  const tg=targetWeight();
  if(tg==null) return goalCTA();
  const pct=goalProgressPct(), lost=kgLost(), left=kgLeft(), rate=bestRate(), ed=etaDays();
  if(left!=null&&left<=0.05) return goalReached();
  let h='<div class="card tap" data-act="go" data-route="/objectif">';
  h+='<div class="goal-ring-wrap">'
   +ringHTML(pct||0,{size:88,stroke:9,color:'var(--acc)',center:'<span style="font-size:15px">'+Math.round((pct||0)*100)+' %</span>'})
   +'<div style="flex:1;min-width:0">'
   +'<div class="row-title">Objectif '+fmtKg(tg)+'</div>'
   +'<div class="small muted" style="margin-top:2px">'+(lost!=null?sgnKg(-lost)+' faits · ':'')+'<b>'+fmtKg(left)+' restants</b></div>'
   +'<div class="bar" style="margin-top:9px"><span class="bar-seg" data-bar="'+(pct||0).toFixed(3)+'" style="background:var(--grad-brand)"></span></div>'
   +'</div></div>';
  h+='<div class="divider"></div><div class="stats">'
   +statCard('Rythme /sem.',rate!=null?((rate>0?'+':MINUS)+nf(Math.abs(rate),2)+NBSP+'kg'):'—',rate!=null?rateWord(rate):'trop tôt',deltaClass(rate,-1))
   +statCard('Il reste',fmtKg(left),'','')
   +statCard('Objectif',ed==null?'—':fmtDateShort(etaDate()),ed==null?'':'dans '+humanDuration(ed),'')
   +'</div>';
  h+='<div class="small muted" style="margin-top:10px">'+esc(etaLine(ed,rate))+'</div>';
  return h+'</div>';
}
function etaLine(ed,rate){
  if(ed==null) return 'Pas encore assez de recul pour estimer une date — encore quelques pesées et je te dis ça.';
  if(ed===0) return 'Tu y es.';
  if(rate!=null&&Math.abs(rate)>1.2)
    return 'À ce rythme, vers le '+fmtDateLong(etaDate())+'. Attention quand même : plus d’un kilo par semaine, c’est beaucoup — le corps préfère la régularité.';
  return 'À ce rythme, tu y es vers le '+fmtDateLong(etaDate())+'.';
}
function goalCTA(){
  return '<div class="card"><div class="row-title flex aic gap8">'+ic('target','ic--sm')+'Fixe-toi un objectif</div>'
    +'<div class="small muted" style="margin:4px 0 12px">Un cap, même approximatif, change tout : tu vois ta progression au lieu de voir un chiffre isolé. Tu pourras le modifier quand tu veux.</div>'
    +'<button class="btn btn--primary btn--block" data-act="edit-goal">Choisir mon objectif</button></div>';
}
function goalReached(){
  const t=trendNow(), band=state.settings.goal.maintainBandKg||1.5, tg=targetWeight();
  const inBand=Math.abs(t-tg)<=band;
  return '<div class="card card--accent">'
    +'<div class="row-title flex aic gap8">'+ic('trophy','ic--sm')+'Objectif atteint</div>'
    +'<div class="small muted" style="margin:4px 0 10px">'
    +(inBand?'Tu es dans ta zone de maintien ('+fmtKg(tg-band)+' – '+fmtKg(tg+band)+'). Le plus dur est fait : maintenant, on tient.'
            :'Tu as franchi ton objectif. Envie de viser plus bas, ou de passer en maintien ?')+'</div>'
    +'<div class="bar"><span class="bar-seg" data-bar="1" style="background:var(--grad-brand)"></span></div>'
    +'<div class="row-2" style="margin-top:12px">'
    +'<button class="btn btn--ghost" data-act="edit-goal">Nouvel objectif</button>'
    +'<button class="btn btn--primary" data-act="set-maintain">Passer en maintien</button></div></div>';
}

/* ---------- Bloc E : paliers ---------- */
function homeMilestone(){
  if(weighIns().length<2) return '';
  /* On ne compte que les paliers encore visibles : un module coupé retire ses paliers
     de la liste, le compteur doit suivre sinon il annonce des paliers introuvables. */
  const done=(state.milestones||[]).filter(m=>defByCode(m.code)).sort((a,b)=>a.reachedAt<b.reachedAt?1:-1);
  const next=nextMilestone();
  if(!next&&!done.length) return '';
  let h='<div class="card">';
  if(next){
    h+='<div class="today-top"><div class="today-ic is-acc">'+ic(next.def.icon)+'</div>'
     +'<div class="row-main"><div class="stat-label">Prochain palier</div>'
     +'<div class="row-title">'+esc(next.def.label)+'</div>'
     +'<div class="small muted">'+esc(next.remainText)+(next.def.why?' · '+esc(next.def.why):'')+'</div></div></div>'
     +'<div class="bar" style="margin-top:10px"><span class="bar-seg" data-bar="'+next.pct.toFixed(3)+'" style="background:var(--grad-brand)"></span></div>';
  }
  if(done.length){
    const der=defByCode(done[0].code);
    h+=(next?'<div class="divider"></div>':'')
     +'<div class="flex between aic tap" data-act="go" data-route="/paliers">'
     +'<div style="min-width:0"><div class="stat-label">'+done.length+' '+plural(done.length,'palier')+' '+plural(done.length,'franchi')+'</div>'
     +(der?'<div class="small muted flex aic gap8" style="margin-top:3px">'+ic(der.icon,'ic--sm')+esc(der.label)+'</div>':'')+'</div>'
     +arrowHTML()+'</div>';
  }
  return h+'</div>';
}

/* ---------- Bloc F : stats clés ---------- */
function homeStats(){
  const d=sinceStartDays(), lost=kgLost(), t=trendNow();
  const fat=totalDelta(PICK_FATK), fatp=totalDelta(PICK_FATP), mus=totalDelta(PICK_MUSK);
  const b=(t!=null)?bmiOf(t):null, w0=startWeight(), b0=(w0!=null)?bmiOf(w0):null;
  /* Quatre cases, pas six : au-delà on ne lit plus, on balaye. Les mesures moins
     parlantes (nombre de pesées, IMC de départ) passent dans la ligne du dessous. */
  const cells=[];
  if(lost!=null) cells.push(statCard('Poids perdu',sgnKg(-lost),equivShort(lost)||'',deltaClass(-lost,-1)));
  if(fat&&metricOn('fat')) cells.push(statCard('Masse grasse',sgnKg(fat.delta),fatp?sgnPt(fatp.delta):staleSub(fat.lastDate),deltaClass(fat.delta,-1)));
  if(mus&&metricOn('muscle')) cells.push(statCard('Muscle',sgnKg(mus.delta),staleSub(mus.lastDate)||'',deltaClass(mus.delta,1)));
  if(b!=null) cells.push(statCard('IMC',nf(b,1),(b0!=null&&Math.abs(b0-b)>=0.1)?('était '+nf(b0,1)):bmiCat(b),''));
  if(cells.length<4&&d!=null) cells.push(statCard('Depuis le début',d+' j',humanDuration(d),''));
  if(cells.length<4) cells.push(statCard('Pesées',String(weighIns().length),adherencePct()!=null?(adherencePct()+' % des jours'):'',''));
  if(!cells.length) return '';
  const shown=cells.slice(0,4);
  let h='<div class="stats'+(shown.length===4?' stats-2':'')+'">'+shown.join('')+'</div>';
  const bits=[];
  if(d!=null&&cells.length>=4) bits.push(humanDuration(d)+' de suivi');
  bits.push(weighIns().length+' '+plural(weighIns().length,'pesée')+(adherencePct()!=null?' · '+adherencePct()+' % des jours':''));
  h+='<div class="small muted center" style="margin:8px 4px 0">'+esc(bits.join(' · '))+'</div>';
  return h+bmiLine(b,b0);
}
function staleSub(lastDate){ const n=diffDays(lastDate,isoToday()); return n>=3?('il y a '+n+' j'):''; }
function bmiLine(b,b0){
  if(b==null){
    if(state.settings.profile.heightCm) return '';
    return '<div class="card" style="margin-top:10px"><div class="small muted">Ajoute ta taille pour voir ton IMC.</div>'
      +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/reglages" style="margin-top:8px">Renseigner ma taille</button></div>';
  }
  /* La carte ne s'affiche que si elle annonce un cap à venir : répéter la définition
     de l'IMC tous les matins n'apprend rien à personne. */
  const t=trendNow(), nb=t!=null?nextBmiThreshold(t):null;
  if(!(nb&&nb.kg!=null&&t!=null&&nb.kg<t)) return '';
  return '<div class="card tap" style="margin-top:10px" data-act="go" data-route="/objectif">'
   +'<div class="small">Sous <b>'+fmtKg(nb.kg)+'</b>, ton IMC passe sous '+nb.bmi+'. Il te reste '+fmtKg(nb.remainKg)+'.</div>'
   +'<div class="muted xsmall" style="margin-top:5px">L’IMC ne distingue pas le muscle du gras — c’est un repère, pas un verdict.</div></div>';
}

/* ---------- Bloc G : le mot du jour ---------- */
function homeInsight(){
  let ins=insightOfTheDay();
  if(!ins) ins=fallbackTip();
  if(!ins) return '';
  return '<div class="card'+(ins.route?' tap':'')+'"'+(ins.route?(' data-act="go" data-route="'+ins.route+'"'):'')+'>'
    +'<div class="today-top"><div class="today-ic is-acc">'+ic(ins.icon||'bulb')+'</div>'
    +'<div class="row-main"><div class="stat-label">Le mot du jour</div>'
    +'<div class="insight-text">'+esc(ins.text)+'</div></div>'
    +(ins.route?arrowHTML():'')+'</div></div>';
}

/* ---------- Bloc H : pourquoi je fais ça ---------- */
function motivationOfDay(){
  const a=(state.motivations||[]).filter(m=>m.active!==false);
  return a.length?a[dayIndex()%a.length]:null;
}
function homeWhy(){
  const m=motivationOfDay();
  if(!m){
    return '<div class="card card--accent">'
      +'<div class="row-title flex aic gap8">'+ic('quote','ic--sm')+'Pourquoi tu fais ça ?</div>'
      +'<div class="small muted" style="margin:5px 0 12px">Écris-le une fois. Les matins difficiles, c’est ça que tu reliras — pas le chiffre.</div>'
      +'<button class="btn btn--primary btn--block" data-act="add-motivation">Écrire ma raison</button></div>';
  }
  const n=(state.motivations||[]).filter(x=>x.active!==false).length;
  return '<div class="card why-card tap" data-act="go" data-route="/motivations">'
    +'<div class="stat-label">Pourquoi tu fais ça</div>'
    +'<div class="why-text">'+uem(m.emoji||'💭')+' «&nbsp;'+esc(m.text)+'&nbsp;»</div>'
    +'<div class="small muted" style="margin-top:8px">'+(n>1?(n+' raisons enregistrées · une par jour ›'):'Ajouter une autre raison ›')+'</div></div>';
}

/* ---------- Bloc I : rappel de sauvegarde ---------- */
function homeBackup(){
  if(!backupOverdue()||!weighIns().length) return '';
  const sn=state.ui.backupSnoozeUntil;
  if(sn&&isoToday()<sn) return '';
  return '<div class="card card--warn" style="margin-top:14px">'
   +'<div class="row-title flex aic gap8">'+ic('save','ic--sm')+'Une sauvegarde s’impose</div>'
   +'<div class="small muted" style="margin:6px 0 10px">'
   +(state.meta.lastBackupAt||state.meta.lastCloudAt?'Plus d’une semaine sans copie de sécurité.':'Tes chiffres n’existent que sur ce téléphone.')
   +' '+weighIns().length+' '+plural(weighIns().length,'pesée')+' : ce serait dommage.</div>'
   +'<button class="btn btn--primary btn--block" data-act="bk-share">'+ic('upload')+'Sauvegarder maintenant</button>'
   +'<button class="btn btn--ghost btn--block" data-act="bk-snooze" style="margin-top:8px">Plus tard</button></div>';
}

/* ---------- Démarrage à froid ---------- */
function screenOnboarding(){
  const p=state.settings.profile;
  return '<div class="card hero" style="padding:26px 18px">'
   +'<div class="ob-mark">'+ic('sprout','ic--xl')+'</div>'
   +'<div class="hero-value" style="font-size:26px;margin-top:8px">Bienvenue sur Élan</div>'
   +'<p class="muted small" style="margin:10px auto 0;max-width:290px;line-height:1.55">Tu te pèses chaque matin. Moi, je transforme ces chiffres en progression. Tout reste sur ton téléphone.</p></div>'
   +'<div class="card" style="margin-top:12px">'
   +'<div class="field"><label>Ta taille</label><div class="row-2">'
   +'<input class="input tnum" id="obHeight" type="number" inputmode="numeric" min="120" max="230" step="1" value="'+(p.heightCm||'')+'" placeholder="182">'
   +'<div class="chip" style="justify-content:center">cm</div></div>'
   +'<div class="hint">Sert uniquement à calculer ton IMC.</div></div>'
   +'<div class="field"><label>Ton poids aujourd’hui</label><div class="row-2">'
   +'<input class="input tnum" id="obWeight" inputmode="decimal" placeholder="110,0">'
   +'<div class="chip" style="justify-content:center">kg</div></div></div>'
   +'<div class="field"><label>Ton objectif <span class="muted">(modifiable quand tu veux)</span></label><div class="row-2">'
   +'<input class="input tnum" id="obTarget" inputmode="decimal" placeholder="99,0">'
   +'<div class="chip" style="justify-content:center">kg</div></div>'
   +'<div class="hint" id="obHint">Pas d’idée ? Vise −10 % pour commencer : c’est le palier qui change le plus de choses.</div></div>'
   +'<div class="field"><label>Pourquoi tu fais ça ?</label>'
   +'<textarea class="input" id="obWhy" placeholder="Ex. : monter les escaliers sans souffler, rentrer dans ma veste préférée, tenir tout un match…"></textarea>'
   +'<div class="hint">Cette phrase te sera resservie les matins où la balance ne bouge pas.</div></div>'
   +'<button class="btn btn--primary btn--block btn--lg" data-act="onboard-save" style="margin-top:6px">C’est parti</button>'
   +'<div class="small muted center" style="margin-top:10px">Tu pourras tout modifier dans les réglages.</div>'
   +'</div>';
}

/* ============================================================
   ÉCRAN : COURBES
   ------------------------------------------------------------
   La demande centrale de l'utilisateur : voir chaque métrique
   EN % ET EN KG. Un % de gras qui baisse pendant que le poids
   baisse ne dit rien sur le gras perdu ; les kilos, si.
   ============================================================ */
const CH_DEFAULT={view:'compo',period:'90',metric:'weight',overlayWeight:false,avg7:true,goalLine:true,lag:2,gapDays:2,calOverlay:'delta'};
function CH(){
  const c=state.ui.charts||(state.ui.charts={});
  for(const k in CH_DEFAULT) if(c[k]===undefined) c[k]=CH_DEFAULT[k];
  return c;                       // TOUJOURS la même référence, sinon les bascules se perdent
}
function chUnit(){ const m=CH().metric; return isDualKey(m)||m==='lean' ? metricUnit(m) : null; }
function chRange(){
  const to=isoToday(), p=CH().period;
  if(p==='all'){ const f=state.entries.length?state.entries[0].date:addDayYMD(to,-30);
    return {from:f,to:to,span:diffDays(f,to)}; }
  const n={'30':30,'90':90,'180':182,'365':365}[p]||90;
  let from=addDayYMD(to,-(n-1));
  /* La fenêtre ne remonte jamais avant la première pesée : demander « 6 mois »
     quand on suit depuis trois semaines écrasait toute la courbe contre le bord
     droit. Une fois qu'il y a six mois de données, le bouton reprend son sens
     littéral — on ne perd donc rien, on évite juste un cadrage absurde. */
  const f0=state.entries.length?state.entries[0].date:null;
  if(f0&&f0>from) from=addDayYMD(f0,-1);
  return {from:from,to:to,span:Math.max(1,diffDays(from,to))};
}
function seriesPoints(metric,unit,from,to){
  const out=[];
  for(const e of state.entries){
    if(e.date<from||e.date>to) continue;
    const v=mv(e,metric,unit);
    if(v!=null&&isFinite(v)) out.push({date:e.date,v:v});
  }
  return out;
}
function slopePerWeek(pts){
  if(pts.length<4) return null;
  let sx=0,sy=0; for(const p of pts){ sx+=dayNum(p.date); sy+=p.v; }
  const n=pts.length,mx=sx/n,my=sy/n; let num=0,den=0;
  for(const p of pts){ const dx=dayNum(p.date)-mx; num+=dx*(p.v-my); den+=dx*dx; }
  return den?(num/den)*7:null;
}
function chStats(pts){
  if(!pts.length) return null;
  let mn=pts[0],mx=pts[0];
  for(const p of pts){ if(p.v<mn.v) mn=p; if(p.v>mx.v) mx=p; }
  const first=pts[0], last=pts[pts.length-1];
  return {min:mn,max:mx,first:first,last:last,
    delta:pts.length>1?last.v-first.v:null,
    days:diffDays(first.date,last.date),
    rate:slopePerWeek(pts),n:pts.length};
}
function chGoal(metric,unit){
  if(metric==='weight'&&targetWeight()!=null) return {v:targetWeight(),label:'Objectif '+nf(targetWeight(),1)+NBSP+'kg'};
  if(metric==='fat'&&unit==='pct'&&state.settings.goal.fatPct!=null)
    return {v:state.settings.goal.fatPct,label:'Objectif '+nf(state.settings.goal.fatPct,1)+NBSP+'%'};
  return null;
}
function screenCourbes(){
  const c=CH();
  if(!weighIns().length)
    return head('Courbes')+empty('chart','Pas encore de courbe','Ta première pesée fera apparaître le graphique. Une seule suffit pour commencer.',
      '<button class="btn btn--primary" data-act="weigh-in">+ Saisir ma pesée</button>');
  const tabs=[['compo','Composition']];
  if(state.settings.modules.sport) tabs.push(['sport','Sport']);
  if(state.settings.modules.kcalIn) tabs.push(['calories','Calories']);
  if(state.settings.modules.sport||state.settings.modules.kcalIn) tabs.push(['croise','Croisements']);
  if(!tabs.some(t=>t[0]===c.view)) c.view='compo';   // une vue dont le module est coupé n'existe plus
  let h=head('Courbes');
  if(tabs.length>1) h+='<div class="subtabs">'+tabs.map(t=>
    '<button class="subtab'+(c.view===t[0]?' is-active':'')+'" data-act="ch-view" data-v="'+t[0]+'">'+esc(t[1])+'</button>').join('')+'</div>';
  h+=segHTML([['30','30 j'],['90','90 j'],['180','6 mois'],['365','1 an'],['all','Tout']],c.period,'ch-period','',' data-p=""');
  if(c.view==='compo') h+=courbesCompo();
  else if(c.view==='sport') h+=courbesSport();
  else if(c.view==='croise') h+=courbesCroisements();
  else h+=courbesCalories();
  return h;
}
function courbesCompo(){
  const c=CH(), r=chRange();
  /* La masse maigre se déduit de la masse grasse : sans elle, elle n'a plus de sens. */
  const shown=METRIC_ORDER.filter(k=>metricOn(k)&&METRICS[k].kind!=='derived').concat(['bmi'])
    .concat(metricOn('fat')?['lean']:[]);
  if(shown.indexOf(c.metric)<0) c.metric='weight';
  const m=c.metric, M=METRICS[m], unit=chUnit();
  let h='<div class="chip-row" style="margin-top:10px">'+shown.map(k=>
    '<button class="chip'+(k===m?' is-active':'')+'" data-act="ch-metric" data-m="'+k+'">'
    +'<span class="chip-ic" style="color:'+METRICS[k].color+'">'+ic(METRICS[k].icon,'ic--sm')+'</span>'+esc(METRICS[k].short)+'</button>').join('')+'</div>';
  if(isDualKey(m)||m==='lean')
    h+='<div style="margin:2px 0 10px">'+segHTML([['pct','%'],['kg','kg']],unit,'ch-unit','')+'</div>';

  const pts=seriesPoints(m,unit,r.from,r.to);
  const wpts=c.overlayWeight&&m!=='weight'?seriesPoints('weight','kg',r.from,r.to):[];
  const st=chStats(pts);
  const id='chm';
  const series=[{key:m,label:M.label,color:M.color,unit:unitLabel(m,unit),dec:metricDec(m,unit),points:pts,area:m==='weight'}];
  if(wpts.length) series.push({key:'weight',label:'Poids',color:METRICS.weight.color,unit:'kg',dec:1,points:wpts,axis:'right',dash:'6 4',width:1.6,dots:false});
  const goal=c.goalLine?chGoal(m,unit):null;

  h+='<div class="chart-card">'
   +'<div class="chart-readout" id="ro-'+id+'" aria-live="polite">'+chReadoutDefault(pts,m,unit)+'</div>'
   +chartSlot(w=>lineChart(series,{w:w,h:CH_H,from:r.from,to:r.to,goal:goal,
       avg:(c.avg7?{win:7,mode:'band'}:null),rightAxis:!!wpts.length,scrub:true,id:id,readoutId:'ro-'+id,
       yUnit:unitLabel(m,unit)}),{h:CH_H,scrub:true,id:id})
   +'<div class="chart-legend">'
   +'<span class="legend-item" style="color:'+M.color+'"><i></i>'+esc(M.label)+'</span>'
   +(c.avg7?'<span class="legend-item"><i style="border-top-width:6px;opacity:.35;color:'+M.color+'"></i>tendance 7 jours</span>':'')
   +(wpts.length?'<span class="legend-item" style="color:'+METRICS.weight.color+'"><i class="dash"></i>poids (axe droit)</span>':'')
   +'</div></div>';

  if(st){
    h+='<div class="stats stats-2" style="margin-top:12px">'
     +statCard('Minimum',fmtMetric(st.min.v,m,unit),fmtDateShort(st.min.date),'')
     +statCard('Maximum',fmtMetric(st.max.v,m,unit),fmtDateShort(st.max.date),'')
     +statCard('Sur la période',st.delta==null?'—':((st.delta>0?'+':MINUS)+nf(Math.abs(st.delta),metricDec(m,unit))+NBSP+unitLabel(m,unit)),
        'en '+st.days+' j',signCls(st.delta,M.better))
     +statCard('Rythme',st.rate==null?'—':((st.rate>0?'+':MINUS)+nf(Math.abs(st.rate),2)+' /sem.'),
        st.n+' '+plural(st.n,'pesée'),signCls(st.rate,M.better))
     +'</div>';
  }
  h+='<div class="chart-toggles">'
   +'<button class="chip'+(c.overlayWeight?' is-active':'')+'" data-act="ch-toggle" data-k="overlayWeight">Poids superposé</button>'
   +'<button class="chip'+(c.avg7?' is-active':'')+'" data-act="ch-toggle" data-k="avg7">Moyenne 7 j</button>'
   +'<button class="chip'+(c.goalLine?' is-active':'')+'" data-act="ch-toggle" data-k="goalLine">Objectif</button>'
   +'</div>';
  h+='<div class="hint" style="margin:8px 4px 0">La bande épaisse lisse les variations d’eau et de sel : c’est elle qui dit si tu progresses, pas la pesée du jour.</div>';

  /* Le nudge pédagogique %/kg : la vraie réponse à « le % ne veut pas dire grand-chose ». */
  if(isDualKey(m)&&m!=='bone'){
    const dp=chStats(seriesPoints(m,'pct',r.from,r.to)), dk=chStats(seriesPoints(m,'kg',r.from,r.to));
    if(dp&&dk&&dp.delta!=null&&dk.delta!=null&&(Math.sign(dp.delta)!==Math.sign(dk.delta)||Math.abs(dk.delta)>1.4*Math.abs(dp.delta*(trendNow()||100)/100))){
      h+='<div class="insight" style="margin-top:12px"><div class="insight-ic">'+ic('bulb')+'</div><div class="insight-txt">'
       +'Sur cette période, ton <strong>pourcentage</strong> de '+esc(M.label.toLowerCase())+' a bougé de '+sgnPt(dp.delta)
       +', mais en <strong>kilos</strong> c’est '+sgnKg(dk.delta)+'. C’est la valeur en kilos qui dit la vérité : le pourcentage bouge aussi quand le poids bouge.'
       +'</div></div>';
    }
  }
  /* Composition du jour : gras vs maigre. On n'empile jamais gras + muscle + eau (l'eau est comptée dans le muscle). */
  h+=courbesCompoDonut();
  h+=courbesHeatPesees(r);
  return h;
}
function chReadoutDefault(pts,m,unit){
  if(!pts.length) return '<span class="ro-none">aucune donnée sur la période</span>';
  const last=pts[pts.length-1], prev=pts.length>1?pts[pts.length-2]:null;
  let h='<span class="ro-date">'+esc(capit(parseYMD(last.date).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})))+'</span>'
   +'<span class="ro-v" style="color:'+METRICS[m].color+'">'+esc(fmtMetric(last.v,m,unit))+'</span>';
  if(prev){ const d=last.v-prev.v; const gap=diffDays(prev.date,last.date);
    h+='<span class="ro-d '+signCls(d,METRICS[m].better)+'">'+(d>0?'+':MINUS)+nf(Math.abs(d),metricDec(m,unit))+(gap>1?' ('+gap+' j)':'')+'</span>'; }
  return h;
}
function courbesCompoDonut(){
  if(!metricOn('fat')) return '';
  const e=lastWeighIn(); if(!e) return '';
  const w=mv(e,'weight'), f=metricValue(e,'fat','kg');
  if(w==null||!f) return '';
  const fat=f.value, lean=w-fat;
  const wa=metricValue(e,'water','kg'), mu=metricValue(e,'muscle','kg');
  let h='<div class="chart-card"><div class="chart-title">Composition du '+esc(fmtDateShort(e.date))+'</div>'
   +donutChart([{label:'Masse grasse',v:fat,color:METRICS.fat.color},{label:'Masse maigre',v:lean,color:METRICS.maigre?METRICS.maigre.color:'var(--m-maigre)'}],
      {size:168,stroke:24,center:'<div><div style="font-size:19px">'+nf(w,1)+'</div><div class="muted xsmall">kg au total</div></div>'})
   +'<div class="chart-legend" style="justify-content:center">'
   +'<span class="legend-item"><span class="legend-dot" style="background:'+METRICS.fat.color+'"></span>Gras '+nf(fat,1)+' kg</span>'
   +'<span class="legend-item"><span class="legend-dot" style="background:var(--m-maigre)"></span>Maigre '+nf(lean,1)+' kg</span>'
   +'</div>';
  const extra=[];
  if(mu) extra.push(statCard('Muscle',nf(mu.value,1)+NBSP+'kg',mv(e,'muscle','pct')!=null?nf(mv(e,'muscle','pct'),1)+' %':'',''));
  if(wa) extra.push(statCard('Eau',nf(wa.value,1)+NBSP+'kg',mv(e,'water','pct')!=null?nf(mv(e,'water','pct'),1)+' %':'',''));
  if(extra.length) h+='<div class="stats stats-2" style="margin-top:10px">'+extra.join('')+'</div>';
  h+='<div class="hint" style="margin-top:8px">Muscle et eau se recoupent (le muscle contient de l’eau) : on ne les additionne jamais au gras.</div>';
  return h+'</div>';
}
function courbesHeatPesees(r){
  const days={}; weighIns().forEach(e=>{ days[e.date]=1; });
  return '<div class="chart-card"><div class="chart-title">Jours de pesée</div>'
    +chartSlot(w=>calendarHeatmap(days,{cell:12,gap:2,color:'var(--m-poids)',buckets:[1,1,1],
        from:addDayYMD(isoToday(),-181),to:isoToday(),onDay:'hm-weigh'}),{h:130,hscroll:true})
    +'<div class="small muted center" style="margin-top:6px">'+weighIns().length+' '+plural(weighIns().length,'pesée')+' · '
    +(adherencePct()!=null?adherencePct()+' % des jours depuis le début':'')+'</div></div>';
}
function courbesSport(){
  const r=chRange();
  const bucket=r.span<=180?'week':'month';
  const bars=[];
  if(bucket==='week'){
    let wk=weekStartYMD(r.from);
    while(wk<=r.to){ const end=addDayYMD(wk,6);
      const min=(state.sessions||[]).filter(s=>s.date>=wk&&s.date<=end).reduce((a,x)=>a+(x.durationMin||0),0);
      bars.push({date:addDayYMD(wk,3),v:min,color:'var(--m-sport)',label:fmtDateShort(wk)});
      wk=addDayYMD(wk,7); }
  } else {
    let mk=monthKey(r.from);
    while(mk<=monthKey(r.to)){
      const min=(state.sessions||[]).filter(s=>monthKey(s.date)===mk).reduce((a,x)=>a+(x.durationMin||0),0);
      bars.push({date:mk+'-15',v:min,color:'var(--m-sport)',label:MOIS3[parseInt(mk.slice(5),10)-1]});
      mk=monthKey(addMonthsYMD(mk+'-01',1)); }
  }
  const list=(state.sessions||[]).filter(s=>s.date>=r.from&&s.date<=r.to);
  const minutes=list.reduce((a,x)=>a+(x.durationMin||0),0);
  const weeks=Math.max(1,Math.round(r.span/7));
  let h='<div class="chart-card"><div class="chart-title">Minutes par '+(bucket==='week'?'semaine':'mois')+'</div>'
   +chartSlot(w=>barChart(bars,{w:w,h:CH_H2,from:r.from,to:r.to,bucket:bucket,dec:0,
       target:bucket==='week'?(state.settings.sport.weeklyGoalMin||0):0}),{h:CH_H2})
   +'</div>';
  h+='<div class="stats stats-2" style="margin-top:12px">'
   +statCard('Séances',String(list.length),'','')
   +statCard('Temps total',fmtMin(minutes),'','')
   +statCard('Moyenne /sem.',fmtMin(Math.round(minutes/weeks)),'','')
   +statCard('Série',streakWeeks()+' sem.','avec au moins une séance','')
   +'</div>';
  const days={}; (state.sessions||[]).forEach(s=>{ days[s.date]=(days[s.date]||0)+(s.durationMin||0); });
  const planned={}; if(typeof planOccurrences==='function')
    planOccurrences(isoToday(),addDayYMD(isoToday(),30)).forEach(o=>{ planned[o.date]=true; });
  h+='<div class="chart-card"><div class="chart-title">Jours d’entraînement</div>'
   +chartSlot(w=>calendarHeatmap(days,{cell:13,gap:2,color:'var(--m-sport)',planned:planned,
       from:addDayYMD(isoToday(),-181),to:addDayYMD(isoToday(),13),onDay:'hm-sport'}),{h:135,hscroll:true})
   +'<div class="chart-legend" style="justify-content:center"><span class="legend-item">Moins</span>'
   +'<span class="legend-dot" style="background:var(--bg-3)"></span>'
   +'<span class="legend-dot" style="background:rgba(56,189,248,.35)"></span>'
   +'<span class="legend-dot" style="background:rgba(56,189,248,.7)"></span>'
   +'<span class="legend-dot" style="background:var(--m-sport)"></span>'
   +'<span class="legend-item">Plus</span></div></div>';
  h+=sportSplitBars(list);
  return h;
}
function sportSplitBars(list){
  const by={};
  list.forEach(s=>{ if(!by[s.activityKey]) by[s.activityKey]={min:0,cnt:0}; by[s.activityKey].min+=(s.durationMin||0); by[s.activityKey].cnt++; });
  const rows=Object.keys(by).map(k=>({k:k,min:by[k].min,cnt:by[k].cnt})).sort((a,b)=>b.min-a.min);
  if(!rows.length) return '';
  const mx=rows[0].min||1;
  return '<div class="section-title">Répartition</div><div class="card"><div class="chart-bars">'
   +rows.map(r=>'<div><div class="cbtop"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+uem(actEmoji(r.k))+' '+esc(actLabel(r.k))+'</span>'
     +'<span class="tnum muted nowrap">'+fmtMin(r.min)+' · '+r.cnt+'</span></div>'
     +'<div class="chart-bar-track"><div class="chart-bar-fill" data-bar="'+(r.min/mx).toFixed(3)+'" style="background:'+actColor(r.k)+'"></div></div></div>').join('')
   +'</div></div>';
}
function courbesCalories(){
  const c=CH(), r=chRange();
  const kin=[]; state.entries.forEach(e=>{ if(e.date<r.from||e.date>r.to) return;
    const v=mv(e,'kcalIn'); if(v!=null) kin.push({date:e.date,v:v,color:'#F0A93B'}); });
  if(!kin.length)
    return empty('plate','Aucune calorie notée sur la période',
      'Note le total que Yazio t’affiche le soir : c’est ce qui permet à Élan de calculer ta dépense réelle et de trouver ton décalage.',
      '<button class="btn btn--primary" data-act="quick-kcal">+ Noter mes calories</button>');
  const lag=Math.min(XC_MAX_LAG,Math.max(1,c.lag|0));   // la pesée du matin précède les repas du jour
  const shifted=kin.map(p=>({date:addDayYMD(p.date,lag),v:p.v,color:'#F0A93B'})).filter(p=>p.date<=r.to);
  /* Deux lectures possibles de la réaction du poids : le soubresaut du lendemain
     (brut, bruyant) ou la tendance lissée (calme, plus honnête). */
  const mode=c.calOverlay||'delta';
  const ov=(mode==='trend')
    ? {points:trendSeries().filter(x=>x.date>=r.from&&x.date<=r.to).map(x=>({date:x.date,v:x.trend})),color:'var(--m-poids)',dec:1,unit:'kg'}
    : {points:dailyDeltaWeight(r.from,r.to),color:'var(--m-poids)',dec:2,unit:'kg'};
  const neutral=maintenanceKcal();
  let h='<div class="chart-card"><div class="chart-title">Calories mangées (décalées de +'+lag+' j) et '+(mode==='trend'?'tendance du poids':'variation de poids')+'</div>'
   +chartSlot(w=>barChart(shifted,{w:w,h:CH_H,from:r.from,to:r.to,bucket:'day',dec:0,
       target:(mode==='delta'&&neutral.kcal!=null)?neutral.kcal:0,overlay:ov}),{h:CH_H})
   +'<div class="chart-legend">'
   +'<span class="legend-item" style="color:#F0A93B"><i></i>kcal mangées</span>'
   +'<span class="legend-item" style="color:var(--m-poids)"><i></i>'+(mode==='trend'?'tendance du poids':'variation de poids')+' (axe droit)</span>'
   +((mode==='delta'&&neutral.kcal!=null)?'<span class="legend-item" style="color:var(--acc)"><i class="dash"></i>ton point neutre</span>':'')
   +'</div></div>';
  h+='<div class="chart-toggles">'
   +'<button class="chip'+(mode==='delta'?' is-active':'')+'" data-act="ch-caloverlay" data-v="delta">Variation jour à jour</button>'
   +'<button class="chip'+(mode==='trend'?' is-active':'')+'" data-act="ch-caloverlay" data-v="trend">Tendance lissée</button>'
   +'</div>';

  /* Les chiffres qui manquaient : moyenne, écart au point neutre, jours renseignés. */
  const vals=kin.map(p=>p.v), moy=meanOf(vals);
  const jours=diffDays(r.from,r.to)+1;
  h+='<div class="stats stats-2" style="margin-top:12px">'
   +statCard('Moyenne',nf(moy,0)+' kcal','sur '+kin.length+' '+plural(kin.length,'jour'),'')
   +statCard('Le plus bas',nf(Math.min.apply(null,vals),0),'','')
   +statCard('Le plus haut',nf(Math.max.apply(null,vals),0),'','')
   +statCard('Renseigné',Math.round(kin.length/jours*100)+' %','des jours de la période','')
   +'</div>';
  if(neutral.kcal!=null){
    const ec=moy-neutral.kcal;
    h+='<div class="sim-gap '+(ec<0?'is-down':(ec>0?'is-up':''))+'" style="margin-top:12px">'
     +(Math.abs(ec)<60?'Tu manges à peu près à ton point neutre ('+nf(neutral.kcal,0)+' kcal) : ton poids devrait rester stable.'
       :(ec<0?'En moyenne <b>'+nf(-ec,0)+' kcal</b> sous ton point neutre ('+nf(neutral.kcal,0)+' kcal), soit environ <b>'+fmtKg(-ec*7/KCAL_PER_KG_FAT)+' par semaine</b> en théorie.'
             :'En moyenne <b>'+nf(ec,0)+' kcal</b> au-dessus de ton point neutre ('+nf(neutral.kcal,0)+' kcal).'))
     +'</div>'
     +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/simulateur" style="margin-top:10px">'+ic('calculator')+'Simuler un autre niveau</button>';
  }

  h+='<div class="section-title">Décaler les barres</div>'
   +segHTML([['1','+1 j'],['2','+2 j'],['3','+3 j'],['4','+4 j'],['5','+5 j']],String(lag),'ch-lag','')
   +'<div class="hint" style="margin:6px 4px 0">Décale les calories vers la droite pour les aligner sur le moment où le poids réagit.</div>';
  h+=xcInsight();
  h+='<div class="hint" style="margin:8px 4px 0">Un lien statistique n’est pas une preuve de cause. Le sel, l’eau et les fibres décalent la balance sans changer le gras.</div>';
  return h;
}
/* Le message sur le décalage calories → poids, gradué selon ce qu'on peut honnêtement dire. */
function xcInsight(){
  const xc=crossCorrIntakeWeight();
  let h='<div class="insight'+(xc.ok&&xc.tier==='solide'?'':' insight--neutral')+'" style="margin-top:12px"><div class="insight-ic">'+ic('plate')+'</div><div class="insight-txt">';
  if(!xc.ok){
    const n=xc.n||0;
    h+='Encore '+Math.max(1,XC_HINT_N-n)+' '+plural(Math.max(1,XC_HINT_N-n),'journée')+' avec <strong>calories ET pesée</strong> et je te dis à quel moment ton poids réagit à ce que tu manges. Tu en as '+n+'.';
  } else {
    const q=xc.best.lag===1?'dès le lendemain matin':xc.best.lag+' jours après';
    if(xc.tier==='solide')
      h+='Chez toi, un gros apport se voit surtout <strong>'+q+'</strong> : +1 000 kcal ≈ '+sgnKg(xc.best.beta*1000)+', sur '+xc.best.n+' journées comparées.'
       +' <button class="btn-add" data-act="ch-lag" data-val="'+xc.best.lag+'">Utiliser ce décalage</button>';
    else if(xc.tier==='piste')
      h+='Le lien apparaît plutôt <strong>'+q+'</strong> (+1 000 kcal ≈ '+sgnKg(xc.best.beta*1000)+'), mais avec '+xc.best.n+' journées c’est encore fragile. Continue à noter, je reprendrai ce calcul.'
       +' <button class="btn-add" data-act="ch-lag" data-val="'+xc.best.lag+'">Essayer ce décalage</button>';
    else
      h+='<strong>Tout premier aperçu</strong>, à prendre avec des pincettes : sur tes '+xc.best.n+' journées, la balance semble réagir '+q+'. Il en faudra une trentaine pour que ce soit sérieux — mais autant regarder tout de suite.'
       +' <button class="btn-add" data-act="ch-lag" data-val="'+xc.best.lag+'">Essayer ce décalage</button>';
  }
  return h+'</div></div>';
}

/* ============================================================
   COURBES — VUE CROISEMENTS
   ------------------------------------------------------------
   « Pourquoi mon poids a monté cette semaine ? » On ne répond
   pas à ça avec une courbe de poids : il faut la mettre à côté
   de ce qui a changé — les calories, les séances, le sel du week-end.
   ============================================================ */
function weekBuckets(nWeeks){
  const out=[]; let wk=weekStartYMD(addDayYMD(isoToday(),-7*(nWeeks-1)));
  for(let i=0;i<nWeeks;i++){
    const end=addDayYMD(wk,6);
    const ent=state.entries.filter(e=>e.date>=wk&&e.date<=end);
    const kin=ent.map(e=>mv(e,'kcalIn')).filter(v=>v!=null);
    const min=(state.sessions||[]).filter(x=>x.date>=wk&&x.date<=end).reduce((a,x)=>a+(x.durationMin||0),0);
    const cnt=(state.sessions||[]).filter(x=>x.date>=wk&&x.date<=end).length;
    const a=trendAt(addDayYMD(wk,-1)), b=trendAt(end);
    out.push({week:wk,mid:addDayYMD(wk,3),end:end,
      kcal:kin.length?meanOf(kin):null,kcalDays:kin.length,
      minutes:min,sessions:cnt,weighs:ent.filter(e=>mv(e,'weight')!=null).length,
      dw:(a!=null&&b!=null)?Math.round((b-a)*100)/100:null,
      past:end<=isoToday()});
    wk=addDayYMD(wk,7);
  }
  return out;
}
function courbesCroisements(){
  const r=chRange();
  const nW=clamp(Math.round((diffDays(r.from,r.to)+1)/7),6,53);   // six semaines au minimum : en dessous, comparer n'a pas de sens
  const W=weekBuckets(nW).filter(w=>w.past||w.weighs>0);
  const withDw=W.filter(w=>w.dw!=null);
  if(withDw.length<2)
    return empty('shuffle','Encore un peu de patience',
      'Ces croisements comparent tes semaines entre elles. Il en faut au moins deux complètes — tu y es presque.',
      '<button class="btn btn--primary" data-act="weigh-in">'+ic('scale')+'Saisir ma pesée</button>');
  /* Cadrage : inutile d'etaler six mois quand on n'a que trois semaines de donnees,
     les barres s'entassent a droite et les dates se chevauchent. */
  const plein=W.filter(w=>w.dw!=null||w.kcal!=null||w.minutes>0);
  const X0=(plein.length?plein[0]:W[0]).mid, X1=(plein.length?plein[plein.length-1]:W[W.length-1]).mid;
  let h='<div class="hint" style="margin:10px 4px 12px">Une semaine efface le bruit du sel et de l’eau : c’est la plus petite unité où les liens deviennent lisibles.</div>';

  /* 1. Calories moyennes vs variation de poids, semaine par semaine. */
  if(state.settings.modules.kcalIn){
    const bars=W.filter(w=>w.kcal!=null).map(w=>({date:w.mid,v:Math.round(w.kcal),color:'#F0A93B',label:fmtDateShort(w.week)}));
    const line=withDw.map(w=>({date:w.mid,v:w.dw}));
    if(bars.length>=2){
      h+='<div class="chart-card"><div class="chart-title">Ce que tu manges → ce que fait ton poids</div>'
       +chartSlot(w2=>barChart(bars,{w:w2,h:CH_H,from:X0,to:X1,bucket:'week',dec:0,
           target:maintenanceKcal().kcal||0,overlay:{points:line,color:'var(--m-poids)',dec:2,unit:'kg'}}),{h:CH_H})
       +'<div class="chart-legend">'
       +'<span class="legend-item" style="color:#F0A93B"><i></i>kcal / jour (moyenne de la semaine)</span>'
       +'<span class="legend-item" style="color:var(--m-poids)"><i></i>kg gagnés ou perdus dans la semaine</span>'
       +'</div><div class="small muted" style="margin-top:8px">'+esc(croiseComment(W,'kcal'))+'</div></div>';
    }
  }
  /* 2. Minutes de sport vs variation de poids. */
  if(state.settings.modules.sport){
    const bars=W.map(w=>({date:w.mid,v:w.minutes,color:'var(--m-sport)',label:fmtDateShort(w.week)}));
    const line=withDw.map(w=>({date:w.mid,v:w.dw}));
    if(bars.some(b=>b.v>0)){
      h+='<div class="chart-card"><div class="chart-title">Tes séances → ce que fait ton poids</div>'
       +chartSlot(w2=>barChart(bars,{w:w2,h:CH_H,from:X0,to:X1,bucket:'week',dec:0,
           target:state.settings.sport.weeklyGoalMin||0,overlay:{points:line,color:'var(--m-poids)',dec:2,unit:'kg'}}),{h:CH_H})
       +'<div class="chart-legend">'
       +'<span class="legend-item" style="color:var(--m-sport)"><i></i>minutes de sport</span>'
       +'<span class="legend-item" style="color:var(--m-poids)"><i></i>kg de la semaine</span>'
       +'</div><div class="small muted" style="margin-top:8px">'+esc(croiseComment(W,'sport'))+'</div></div>';
    }
  }
  /* 3. Bilan cumulé : ce que le calcul prévoyait vs ce que la balance a fait. */
  h+=croiseCumul(r);
  /* 4. Le tableau récapitulatif : une ligne par semaine, tout à côté. */
  h+='<div class="section-title">Semaine par semaine</div><div class="card"><div class="wk-table">'
   +'<div class="wk-row wk-head"><span>Semaine</span>'
   +(state.settings.modules.kcalIn?'<span>kcal/j</span>':'')
   +(state.settings.modules.sport?'<span>sport</span>':'')
   +'<span>poids</span></div>'
   +W.slice().reverse().filter(w=>w.dw!=null||w.kcal!=null||w.minutes>0).slice(0,16).map(w=>
      '<div class="wk-row">'
      +'<span class="wk-d">'+esc(fmtDateShort(w.week))+'</span>'
      +(state.settings.modules.kcalIn?'<span class="tnum">'+(w.kcal!=null?nf(w.kcal,0):'<span class="miss">—</span>')+'</span>':'')
      +(state.settings.modules.sport?'<span class="tnum">'+(w.minutes?fmtMin(w.minutes):'<span class="miss">—</span>')+'</span>':'')
      +'<span class="tnum '+deltaClass(w.dw,-1)+'">'+(w.dw!=null?sgnKg(w.dw):'<span class="miss">—</span>')+'</span>'
      +'</div>').join('')
   +'</div></div>';
  h+='<div class="hint" style="margin:10px 4px 0">Deux choses qui varient ensemble ne se causent pas forcément l’une l’autre. Ces graphiques servent à poser des questions, pas à trancher.</div>';
  return h;
}
/* Un commentaire honnête : on annonce la taille de l'échantillon et on ne conclut pas trop vite. */
function croiseComment(W,kind){
  const rows=W.filter(w=>w.dw!=null&&(kind==='kcal'?w.kcal!=null:true));
  if(rows.length<4) return rows.length+' '+plural(rows.length,'semaine')+' complète'+(rows.length>1?'s':'')
    +' pour l’instant : il en faut quatre avant de chercher un lien. Le graphique, lui, se lit déjà.';
  const xs=rows.map(w=>kind==='kcal'?w.kcal:w.minutes), ys=rows.map(w=>w.dw);
  const r=pearson(xs,ys);
  if(r==null) return 'Tes '+rows.length+' semaines se ressemblent trop pour qu’une comparaison ait du sens.';
  const fort=Math.abs(r)>=0.55&&rows.length>=6;
  if(kind==='kcal'){
    if(fort&&r>0) return 'Sur tes '+rows.length+' semaines, celles où tu manges le plus sont bien celles où le poids monte le plus. Le lien est net.';
    if(fort&&r<0) return 'Curieusement, tes semaines les plus copieuses sont aussi celles où tu perds le plus. C’est souvent le signe que le sport ou l’eau brouillent la lecture.';
    return 'Sur '+rows.length+' semaines, le lien reste flou. C’est normal : une semaine, c’est court, et l’eau pèse plus lourd que la graisse à cette échelle.';
  }
  if(fort&&r<0) return 'Tes semaines les plus sportives sont aussi celles où la balance descend le plus, sur '+rows.length+' semaines observées.';
  if(fort&&r>0) return 'Tes grosses semaines de sport coïncident avec des semaines où le poids monte un peu. Rien d’inquiétant : un muscle sollicité retient de l’eau pendant quelques jours.';
  return 'Sur '+rows.length+' semaines, le sport ne se lit pas directement sur la balance. Il agit surtout sur ce que tu gardes de muscle, et ça, la balance ne le dit pas.';
}
/* Le cumul : additionner les écarts au point neutre, jour après jour, et comparer
   la perte prédite à la perte réelle. C'est le graphique qui explique le mieux
   pourquoi une semaine « sans résultat » n'est pas une semaine perdue. */
function croiseCumul(r){
  const neutral=maintenanceKcal();
  if(!state.settings.modules.kcalIn||neutral.kcal==null) return '';
  const rows=state.entries.filter(e=>e.date>=r.from&&e.date<=r.to&&mv(e,'kcalIn')!=null);
  if(rows.length<7) return '';
  let cum=0; const pred=[];
  rows.forEach(e=>{ cum+=(mv(e,'kcalIn')-neutral.kcal)/KCAL_PER_KG_FAT; pred.push({date:e.date,v:Math.round(cum*100)/100}); });
  const t0=trendAt(rows[0].date);
  const real=trendSeries().filter(x=>x.date>=rows[0].date&&x.date<=r.to&&t0!=null)
    .map(x=>({date:x.date,v:Math.round((x.trend-t0)*100)/100}));
  if(real.length<3) return '';
  const ecart=real.length&&pred.length?(real[real.length-1].v-pred[pred.length-1].v):null;
  return '<div class="chart-card"><div class="chart-title">Ce que le calcul prévoyait, ce que la balance a fait</div>'
   +chartSlot(w=>lineChart([
      {key:'reel',label:'Réel',color:'var(--m-poids)',unit:'kg',dec:2,points:real,dots:false},
      {key:'pred',label:'Prévu',color:'var(--acc)',unit:'kg',dec:2,points:pred,dash:'5 4',dots:false}],
      {w:w,h:CH_H,from:rows[0].date,to:r.to,id:'cum',scrub:false,yUnit:'kg'}),{h:CH_H})
   +'<div class="chart-legend">'
   +'<span class="legend-item" style="color:var(--m-poids)"><i></i>ta tendance réelle</span>'
   +'<span class="legend-item" style="color:var(--acc)"><i class="dash"></i>ce que tes calories prévoyaient</span>'
   +'</div><div class="small muted" style="margin-top:8px">'
   +(ecart==null?'':(Math.abs(ecart)<0.7
      ?'Les deux courbes se suivent à '+nf(Math.abs(ecart),1)+' kg près : tes chiffres sont cohérents, et ton point neutre est bien réglé.'
      :(ecart<0?'Tu as perdu '+fmtKg(-ecart)+' de plus que ce que tes calories prévoyaient. En début de période, c’est presque toujours de l’eau et du glycogène.'
               :'La balance est '+fmtKg(ecart)+' au-dessus de la prévision. Les trois explications habituelles : des portions sous-estimées, un point neutre un peu haut, ou de l’eau qui masque la perte.')))
   +'</div></div>';
}
function dailyDeltaWeight(from,to){
  const out=[]; let prev=null;
  for(const e of state.entries){
    const w=mv(e,'weight'); if(w==null) continue;
    if(prev&&e.date>=from&&e.date<=to&&diffDays(prev.date,e.date)<=3)
      out.push({date:e.date,v:w-prev.v});
    prev={date:e.date,v:w};
  }
  return out;
}
function streakWeeks(){
  let n=0, wk=weekStartYMD(isoToday());
  const has=w=>(state.sessions||[]).some(s=>s.date>=w&&s.date<=addDayYMD(w,6));
  if(!has(wk)) wk=addDayYMD(wk,-7);
  let guard=0; while(guard++<520&&has(wk)){ n++; wk=addDayYMD(wk,-7); }
  return n;
}

/* ============================================================
   ÉCRAN : TABLEAU
   ------------------------------------------------------------
   Le lieu où l'on vérifie ses chiffres. Une colonne % ET une
   colonne kg pour chaque métrique double, comme demandé.
   ============================================================ */
const TBL_DEFAULT={range:'90',sort:'date_desc',limit:120,showGaps:true,del:false};
const TBL_PAGE=120;
function TBL(){
  const t=state.ui.table||(state.ui.table={});
  for(const k in TBL_DEFAULT) if(t[k]===undefined) t[k]=TBL_DEFAULT[k];
  return t;                       // idem : référence stable
}
function tblRange(){
  const to=isoToday(), p=TBL().range;
  if(p==='all'){ const f=state.entries.length?state.entries[0].date:to; return {from:f,to:to}; }
  const n={'30':30,'90':90,'180':182,'365':365}[p]||90;
  return {from:addDayYMD(to,-(n-1)),to:to};
}
function tblRows(from,to){
  const out=[]; let prevW=null,prevD=null;
  for(const e of state.entries){
    const w=mv(e,'weight');
    if(e.date>=from&&e.date<=to)
      out.push({e:e,dW:(w!=null&&prevW!=null)?w-prevW:null,gapDays:prevD?diffDays(prevD,e.date):null});
    if(w!=null){ prevW=w; prevD=e.date; }
  }
  return out;
}
function tblCols(){
  const cols=[{k:'date',grp:'Date',sub:'',cls:'col-date'}];
  activeMetrics().forEach(k=>{
    const M=METRICS[k];
    if(k==='weight'){ cols.push({k:'weight',grp:'Poids',sub:'kg'},{k:'dweight',grp:'Δ',sub:'kg'}); return; }
    if(M.kind==='comp') cols.push({k:k,grp:M.label,sub:'%',dual:'pct',color:M.color},{k:k,grp:'',sub:'kg',dual:'kg',color:M.color});
    else cols.push({k:k,grp:M.short,sub:M.unit||''});
  });
  if(metricOn('weight')) cols.push({k:'bmi',grp:'IMC',sub:''});
  if(state.settings.modules.sport) cols.push({k:'sport',grp:'Sport',sub:'min'});
  cols.push({k:'note',grp:'Note',sub:'',cls:'col-note'});
  return cols;
}
function screenTableau(){
  if(!state.entries.length)
    return head('Tableau')+empty('table','Aucune donnée','Tes pesées apparaîtront ici, ligne par ligne, avec une colonne en % et une en kg.',
      '<button class="btn btn--primary" data-act="weigh-in">+ Saisir ma pesée</button>');
  const t=TBL(), r=tblRange();
  let rows=tblRows(r.from,r.to);
  const total=rows.length;
  if(t.sort==='date_desc') rows=rows.slice().reverse();
  else if(t.sort==='w_desc') rows=rows.slice().sort((a,b)=>(mv(b.e,'weight')||-1)-(mv(a.e,'weight')||-1));
  else if(t.sort==='w_asc') rows=rows.slice().sort((a,b)=>(mv(a.e,'weight')||1e9)-(mv(b.e,'weight')||1e9));
  const shown=rows.slice(0,t.limit);
  const cols=tblCols();
  if(t.del) cols.push({k:'del',grp:'',sub:''});   // colonne « supprimer », jamais dans l'export CSV

  let h=head('Tableau','<button class="btn-add" data-act="weigh-in">+ Pesée</button>');
  h+='<div class="filterbar">'
   +'<select class="input input--sm" id="tblRange">'
   +[['30','30 derniers jours'],['90','90 jours'],['180','6 mois'],['365','1 an'],['all','Tout']].map(o=>
      '<option value="'+o[0]+'"'+(t.range===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>'
   +'<select class="input input--sm" id="tblSort">'
   +[['date_desc','Plus récent d’abord'],['date_asc','Plus ancien d’abord'],['w_desc','Poids ↓'],['w_asc','Poids ↑']].map(o=>
      '<option value="'+o[0]+'"'+(t.sort===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>'
   +'</div>'
   +'<div class="filterbar">'
   +'<button class="chip'+(t.showGaps?' is-active':'')+'" data-act="tbl-toggle" data-k="showGaps">Jours manquants</button>'
   +'<button class="chip'+(t.del?' is-active':'')+'" data-act="tbl-toggle" data-k="del">'+(t.del?ic('close','ic--sm')+'Terminer':ic('trash','ic--sm')+'Supprimer…')+'</button>'
   +'<button class="chip" data-act="tbl-csv">⤓ Export CSV</button>'
   +'<button class="chip" data-act="go-metrics">'+ic('settings','ic--sm')+'Colonnes</button>'
   +'</div>';

  /* La régularité ne se calcule que sur les jours réellement écoulés depuis la première
     pesée : sinon une période de 90 jours affiche « 1 % » le jour de l'installation. */
  const from0=maxYMD(r.from,startDate()||r.from);
  const span=Math.max(1,diffDays(from0,minYMD(r.to,isoToday()))+1);
  const missing=Math.max(0,span-total);
  if(total>0) h+='<div class="small muted" style="margin:0 4px 10px">'+total+' '+plural(total,'pesée')
    +(missing>0?' · '+missing+' '+plural(missing,'jour')+' sans pesée sur '+span+' — '+Math.round(Math.min(100,total/span*100))+' % de régularité':'')+'</div>';

  /* Deux rangées d'en-tête : les groupes (avec colspan sur les métriques doubles), puis les unités. */
  let head1='';
  for(let i=0;i<cols.length;i++){
    const c=cols[i];
    if(c.dual==='kg') continue;                       // absorbé par le colspan du « % »
    const span=(c.dual==='pct')?2:1;
    head1+='<th class="'+(c.cls||'')+'"'+(span>1?' colspan="2"':'')
      +(c.color?' style="box-shadow:inset 0 -2px 0 '+c.color+'"':'')+' scope="col">'+esc(c.grp)+'</th>';
  }
  h+='<div class="table-scroll"><table class="dtable">'
   +'<caption class="sr-only">Toutes les pesées, du '+esc(fmtDateShort(r.from))+' au '+esc(fmtDateShort(r.to))+'</caption>'
   +'<thead><tr>'+head1+'</tr>'
   +'<tr>'+cols.map(c=>'<th class="'+(c.cls||'')+'" scope="col">'+esc(c.sub||'')+'</th>').join('')+'</tr>'
   +'</thead><tbody>';
  let prevDate=null, band=0;
  const body=[];
  shown.forEach(rw=>{
    const e=rw.e;
    if(t.showGaps&&prevDate){
      const a=t.sort==='date_desc'?e.date:prevDate, b=t.sort==='date_desc'?prevDate:e.date;
      const gap=diffDays(a,b);
      if(gap>1) body.push('<tr class="dtable-group" data-act="tbl-gap" data-from="'+a+'" data-to="'+b+'"><td colspan="'+cols.length+'">⋯ '+(gap-1)+' '+plural(gap-1,'jour')+' sans pesée · saisir</td></tr>');
    }
    prevDate=e.date;
    /* Une ligne sur deux est teintée : sur un écran de téléphone, c'est ce qui permet de
       suivre une ligne du regard jusqu'au bout du tableau. Le compteur ignore les lignes
       « jours manquants », sinon l'alternance se casse à chaque trou. */
    const cls=[(band++%2)?'is-alt':'',e.date===isoToday()?'is-today':''].filter(Boolean).join(' ');
    body.push('<tr'+(cls?' class="'+cls+'"':'')+' data-act="tbl-row" data-date="'+e.date+'">'
      +cols.map(c=>tblCell(c,rw)).join('')+'</tr>');
  });
  h+=body.join('')+'</tbody></table></div>';
  if(rows.length>shown.length)
    h+='<button class="btn btn--ghost btn--block" data-act="tbl-more" style="margin-top:10px">Afficher 200 de plus ('+(rows.length-shown.length)+' restantes)</button>';
  h+='<div class="hint" style="margin:10px 4px 0">Le CSV sert à ouvrir tes chiffres dans Excel. Pour changer de téléphone, utilise <b>Sauvegarde</b>.</div>';
  return h;
}
function tblCell(c,rw){
  const e=rw.e;
  const na='<span class="miss" aria-label="non saisi">—</span>';
  if(c.k==='del') return '<td><button class="pill-btn pill-btn--no" data-act="tbl-del" data-date="'+e.date+'" aria-label="Supprimer la pesée du '+esc(fmtDateLong(e.date))+'">'+ic('trash','ic--sm')+'</button></td>';
  if(c.k==='date') return '<td class="col-date">'+esc(fmtTblDate(e.date))+'</td>';
  if(c.k==='note') return '<td class="col-note">'+esc(e.note||'')+'</td>';
  if(c.k==='dweight'){
    if(rw.dW==null) return '<td>'+na+'</td>';
    return '<td><span class="dlt '+signCls(rw.dW,'down')+'">'+(rw.dW>0?'+':MINUS)+nf(Math.abs(rw.dW),1)+'</span>'
      +(rw.gapDays>1?'<span class="miss" style="font-size:10px;margin-left:3px">'+rw.gapDays+'j</span>':'')+'</td>';
  }
  if(c.k==='sport'){ const s=eSportMin(e.date); return '<td>'+(s==null?na:nf(s,0))+'</td>'; }
  const r=metricValue(e,c.k,c.dual||undefined);
  if(!r) return '<td>'+na+'</td>';
  const txt=nf(r.value,metricDec(c.k,c.dual));
  return '<td'+(r.exact?'':' class="miss" title="estimé d’après le poids du '+esc(r.basisDate||'')+'"')+'>'+(r.exact?'':'≈ ')+txt+'</td>';
}
function exportCSV(){
  const r=tblRange(), rows=tblRows(r.from,r.to), cols=tblCols();
  const L=['sep=;'];
  L.push(cols.map(c=>csvEscape(c.grp+(c.sub?' ('+c.sub+')':''))).join(';'));
  rows.forEach(rw=>{
    L.push(cols.map(c=>{
      const e=rw.e;
      if(c.k==='date') return e.date;
      if(c.k==='note') return csvEscape(e.note||'');
      if(c.k==='dweight') return rw.dW==null?'':nf(rw.dW,1).replace(/\s/g,'');
      if(c.k==='sport'){ const s=eSportMin(e.date); return s==null?'':String(s); }
      const v=mv(e,c.k,c.dual||undefined);
      return v==null?'':nf(v,metricDec(c.k,c.dual)).replace(/\s/g,'');
    }).join(';'));
  });
  const text='﻿'+L.join('\r\n');
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='elan-tableau-'+isoToday()+'.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  toast('CSV exporté ('+rows.length+' lignes)');
}
function csvEscape(s){ s=String(s==null?'':s); return /[";\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }

/* ============================================================
   MODULE SPORT : séances réalisées
   ============================================================ */
function seedActivities(){
  const S=[
    ['muscu','Musculation','🏋️','#F2A65A',5.0,3.5,6.0,'moyenne',60,false],
    ['velo','Vélo','🚴','#4C8DFF',7.5,4.0,10.0,'moyenne',45,true],
    ['marche','Marche','🚶','#35C88E',3.8,2.8,5.0,'faible',30,true],
    ['course','Course à pied','🏃','#FF6B4A',9.8,7.0,12.5,'moyenne',30,true],
    ['natation','Natation','🏊','#2DD4BF',7.0,5.3,9.8,'moyenne',45,false],
    ['badminton','Badminton','🏸','#9A7BFF',5.5,4.5,7.0,'moyenne',90,false],
    ['foot','Football','⚽','#7ED957',7.0,5.0,10.0,'forte',90,false],
    ['basket','Basket','🏀','#F0A93B',6.5,5.0,8.5,'moyenne',60,false],
    ['tennis','Tennis / padel','🎾','#E9B44C',7.3,5.0,8.0,'moyenne',60,false],
    ['rando','Randonnée','🥾','#6BAF92',6.0,4.5,7.8,'moyenne',120,true],
    ['corde','Corde à sauter','🪢','#FF8FA3',11.0,8.8,12.3,'forte',15,false],
    ['yoga','Yoga / étirements','🧘','#A7B2C4',2.8,2.0,4.0,'faible',30,false],
    ['hiit','HIIT','🔥','#FB7185',8.0,6.0,10.0,'forte',25,false],
    ['rameur','Rameur','🚣','#5AA9FF',7.0,4.8,8.5,'moyenne',30,true],
    ['elliptique','Elliptique','🌀','#8AB4F8',5.0,4.6,7.0,'moyenne',30,false],
    ['danse','Danse','💃','#F0A93B',5.0,3.5,7.8,'moyenne',45,false],
    ['escalade','Escalade','🧗','#C98A2E',8.0,5.8,10.0,'moyenne',90,false],
    ['boxe','Boxe','🥊','#D64550',7.8,5.5,12.8,'forte',60,false],
    ['autre','Autre','✨','#8A97AD',4.0,3.0,6.0,'moyenne',45,true]];
  const now=new Date().toISOString(); let n=0;
  return S.map(a=>({key:a[0],label:a[1],emoji:a[2],color:a[3],met:a[4],metLow:a[5],metHigh:a[6],
    defaultIntensity:a[7],defaultDurationMin:a[8],tracksDistance:a[9],
    isDefault:true,archived:false,sortOrder:n++,usageCount:0,lastUsedAt:null,createdAt:now,updatedAt:now}));
}
function actByKey(k){ return (state.activities||[]).find(a=>a.key===k)||null; }
function actLabel(k){ const a=actByKey(k); return a?a.label:'Activité supprimée'; }
function actEmoji(k){ const a=actByKey(k); return a?a.emoji:'•'; }
function actColor(k){ const a=actByKey(k); return a?a.color:'#8A97AD'; }
function activeActivities(){ return (state.activities||[]).filter(a=>!a.archived).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)); }
function recentActivities(n){
  return activeActivities().slice().sort((a,b)=>
    String(b.lastUsedAt||'').localeCompare(String(a.lastUsedAt||''))||
    (b.usageCount||0)-(a.usageCount||0)||(a.sortOrder||0)-(b.sortOrder||0)).slice(0,n||6);
}
function slugify(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'activite'; }
function sessionsInRange(from,to){ return (state.sessions||[]).filter(s=>s.date>=from&&s.date<=to)
  .sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:String(a.createdAt).localeCompare(String(b.createdAt))); }
function sessionsOnDay(d){ return sessionsInRange(d,d); }
function metFor(key,intensity){
  const a=actByKey(key); if(!a) return 4.0;
  if(intensity==='faible') return a.metLow!=null?a.metLow:a.met*0.80;
  if(intensity==='forte') return a.metHigh!=null?a.metHigh:a.met*1.25;
  return a.met;
}
/* Poids le plus proche d'une date, en privilégiant le passé à distance égale. */
function weightNearest(d){
  const rows=weighIns(); if(!rows.length) return null;
  let best=null,bd=Infinity;
  rows.forEach(e=>{ const dist=Math.abs(diffDays(e.date,d));
    if(dist<bd||(dist===bd&&e.date<d)){ best=e; bd=dist; } });
  return {kg:mv(best,'weight'),date:best.date,exact:bd===0};
}
function estimateKcal(key,durationMin,intensity,date){
  const w=weightNearest(date);
  const kg=(w&&w.kg)||startWeight()||75;
  const raw=metFor(key,intensity)*kg*((durationMin||0)/60);
  return {kcal:Math.round(raw/5)*5,weightKg:Math.round(kg*10)/10,weightExact:!!(w&&w.exact)};
}
let SS=null;   // brouillon de séance
function openSessionSheet(opt){
  opt=opt||{};
  if(opt.id){
    const s=(state.sessions||[]).find(x=>x.id===opt.id); if(!s) return;
    SS={mode:'edit',id:s.id,date:s.date,activityKey:s.activityKey,durationMin:s.durationMin,
      intensity:s.intensity,distanceKm:s.distanceKm,kcalManual:s.kcalSource==='manual'?s.kcal:null,
      note:s.note||'',planKey:s.planKey||null,kcalTouched:s.kcalSource==='manual',durTouched:true,showMore:false};
  } else {
    const a=actByKey(opt.activityKey)||actByKey(state.ui.lastActivityKey)||recentActivities(1)[0]||activeActivities()[0];
    SS={mode:'new',id:null,date:opt.date||isoToday(),activityKey:a?a.key:'autre',
      durationMin:opt.durationMin||(a&&a.defaultDurationMin)||state.settings.sport.defaultDurationMin||45,
      intensity:(a&&a.defaultIntensity)||'moyenne',distanceKm:null,kcalManual:null,note:'',
      planKey:opt.planKey||null,kcalTouched:false,durTouched:false,showMore:false};
  }
  WEEKLY_GOAL_HIT_BEFORE=weeklyGoal().hit;
  openSheet(SS.mode==='edit'?'Modifier la séance':'Nouvelle séance',sessionSheetBody());
}
let WEEKLY_GOAL_HIT_BEFORE=false;
function sessionSheetBody(){
  const acts=SS.showAll?activeActivities():recentActivities(6);
  const a=actByKey(SS.activityKey);
  let h='<div class="chip-row">'
    +acts.map(x=>'<button class="chip chip--act'+(x.key===SS.activityKey?' is-active':'')+'" data-act="ss-act" data-key="'+x.key+'">'+uem(x.emoji)+' '+esc(x.label)+'</button>').join('')
    +'<button class="chip chip--act" data-act="ss-act-all">'+(SS.showAll?'▲ Moins':'⋯ Toutes')+'</button></div>';
  h+='<div class="field"><label>Durée</label>'
    +'<div class="flex aic gap8" style="justify-content:center;margin:6px 0">'
    +'<button class="chip chip--act" data-act="ss-dur" data-delta="-15">−15</button>'
    +'<div class="tnum" id="ssDurVal" style="min-width:110px;text-align:center;font-size:22px;font-weight:700">'+fmtMin(SS.durationMin)+'</div>'
    +'<button class="chip chip--act" data-act="ss-dur" data-delta="15">+15</button></div>'
    +'<div class="chip-row">'+[15,30,45,60,90,120].map(m=>
      '<button class="chip'+(SS.durationMin===m?' is-active':'')+'" data-act="ss-dur-set" data-min="'+m+'">'+fmtMin(m)+'</button>').join('')+'</div></div>';
  h+='<div class="field"><label>Intensité</label>'
    +segHTML([['faible','Tranquille'],['moyenne','Normale'],['forte','Intense']],SS.intensity,'ss-int','')+'</div>';
  const est=estimateKcal(SS.activityKey,SS.durationMin,SS.intensity,SS.date);
  if(state.settings.sport.kcalMode!=='off')
    h+='<div class="hint" id="ssKcalHint">≈ '+nf(est.kcal,0)+' kcal — estimation d’après '+nf(est.weightKg,1)+' kg'
      +(est.weightExact?'':' (poids le plus proche)')+'</div>';
  h+='<button class="btn-add" data-act="ss-more" style="margin-top:10px">＋ Détails (date, distance, calories, note)</button>'
    +'<div id="ssMore" style="display:'+(SS.showMore?'':'none')+'">'
    +'<div class="field"><label>Date</label><input class="input" type="date" id="ssDate" value="'+SS.date+'" max="'+isoToday()+'">'
    +'<div class="chip-row" style="margin-top:8px">'+[[0,"Aujourd'hui"],[-1,'Hier'],[-2,'Avant-hier']].map(o=>
      '<button class="chip'+(SS.date===addDayYMD(isoToday(),o[0])?' is-active':'')+'" data-act="ss-date" data-d="'+o[0]+'">'+esc(o[1])+'</button>').join('')+'</div></div>'
    +((a&&a.tracksDistance)?'<div class="field"><label>Distance (km)</label><input class="input tnum" id="ssDist" inputmode="decimal" value="'+(SS.distanceKm!=null?SS.distanceKm:'')+'"></div>':'')
    +'<div class="field"><label>Calories brûlées</label><input class="input tnum" id="ssKcal" inputmode="numeric" placeholder="≈ '+nf(est.kcal,0)+'" value="'+(SS.kcalManual!=null?SS.kcalManual:'')+'">'
    +'<div class="hint">Estimation d’après ton poids et la durée. Modifie si ta montre affiche autre chose.</div></div>'
    +'<div class="field"><label>Note</label><textarea class="input" id="ssNote" placeholder="Ex. : 5×5 squat, jambes lourdes">'+esc(SS.note||'')+'</textarea></div>'
    +'</div>';
  h+='<div class="sheet-foot"><button class="btn btn--primary btn--block btn--lg" data-act="save-session">Enregistrer</button>'
    +(SS.mode==='edit'?'<button class="btn btn--danger btn--block" data-act="delete-session" data-id="'+SS.id+'" style="margin-top:8px">Supprimer</button>':'')
    +'</div>';
  return h;
}
function ssRefreshDur(){
  const el=document.getElementById('ssDurVal'); if(el) el.textContent=fmtMin(SS.durationMin);
  const hint=document.getElementById('ssKcalHint');
  if(hint){ const e=estimateKcal(SS.activityKey,SS.durationMin,SS.intensity,SS.date);
    hint.textContent='≈ '+nf(e.kcal,0)+' kcal — estimation d’après '+nf(e.weightKg,1)+' kg'+(e.weightExact?'':' (poids le plus proche)'); }
}
function saveSession(){
  const now=new Date().toISOString();
  const dur=clamp(parseInt(SS.durationMin,10)||0,1,600);
  if(!dur){ toast('Indique une durée'); return; }
  const est=estimateKcal(SS.activityKey,dur,SS.intensity,SS.date);
  const manual=(SS.kcalTouched&&SS.kcalManual!=null&&SS.kcalManual!=='')?Math.round(+SS.kcalManual):null;
  const off=state.settings.sport.kcalMode==='off';
  const rec={date:SS.date,activityKey:SS.activityKey,durationMin:dur,intensity:SS.intensity,
    distanceKm:(SS.distanceKm==null||SS.distanceKm==='')?null:Math.round(parseNum(SS.distanceKm)*10)/10,
    kcal:off?null:(manual!=null?manual:est.kcal),
    kcalSource:manual!=null?'manual':'estimated',kcalWeightKg:manual!=null?null:est.weightKg,
    note:(SS.note||'').trim(),planKey:SS.planKey||null,updatedAt:now};
  let s;
  if(SS.mode==='edit'){ s=(state.sessions||[]).find(x=>x.id===SS.id); if(!s) return; Object.assign(s,rec); }
  else { s=Object.assign({id:uid(),createdAt:now},rec); state.sessions.push(s); }
  const a=actByKey(s.activityKey); if(a){ a.usageCount=(a.usageCount||0)+1; a.lastUsedAt=now; }
  state.ui.lastActivityKey=s.activityKey;
  if(s.planKey) setPlanOcc(s.planKey,'done',s.id); else autoLinkPlan(s);
  const wasNew=SS.mode==='new';
  closeSheet(); haptic(); update();
  if(!WEEKLY_GOAL_HIT_BEFORE&&weeklyGoal().hit&&state.settings.celebrateOn!==false) confetti();
  toast('Séance notée — '+actLabel(s.activityKey)+', '+fmtMin(s.durationMin),
    wasNew?()=>{ state.sessions=state.sessions.filter(x=>x.id!==s.id); if(s.planKey) clearPlanOcc(s.planKey); update(); }:null);
  SS=null;
  setTimeout(()=>checkMilestones({celebrate:true}),400);
}
function deleteSession(id){
  const i=(state.sessions||[]).findIndex(x=>x.id===id); if(i<0) return;
  const s=state.sessions[i]; state.sessions.splice(i,1);
  if(s.planKey) clearPlanOcc(s.planKey);
  closeSheet(); update();
  toast('Séance supprimée',()=>{ state.sessions.splice(i,0,s); if(s.planKey) setPlanOcc(s.planKey,'done',s.id); update(); });
}
function weeklyGoal(anchor){
  anchor=anchor||isoToday();
  const from=weekStartYMD(anchor), to=addDayYMD(from,6);
  const list=sessionsInRange(from,anchor);
  const minutes=list.reduce((s,x)=>s+(x.durationMin||0),0);
  const gMin=state.settings.sport.weeklyGoalMin||0, gSes=state.settings.sport.weeklyGoalSessions||0;
  const pct=gMin?Math.min(1,minutes/gMin):(gSes?Math.min(1,list.length/gSes):1);
  return {from:from,to:to,minutes:minutes,count:list.length,goalMin:gMin,goalSessions:gSes,pct:pct,
    hit:minutes>=gMin&&list.length>=gSes,restMin:Math.max(0,gMin-minutes),
    restSessions:Math.max(0,gSes-list.length),daysLeft:Math.max(0,7-isoDow(anchor))};
}
function sportStats(days,anchor){
  anchor=anchor||isoToday();
  const from=days==='year'?anchor.slice(0,4)+'-01-01':addDayYMD(anchor,-(days-1));
  const list=sessionsInRange(from,anchor);
  const byKey={}; let minutes=0,kcal=0; const daySet={};
  list.forEach(s=>{ minutes+=s.durationMin||0; kcal+=s.kcal||0; daySet[s.date]=1;
    const b=byKey[s.activityKey]||(byKey[s.activityKey]={key:s.activityKey,count:0,minutes:0,kcal:0});
    b.count++; b.minutes+=s.durationMin||0; b.kcal+=s.kcal||0; });
  return {from:from,to:anchor,count:list.length,minutes:minutes,kcal:kcal,
    daysActive:Object.keys(daySet).length,
    byActivity:Object.keys(byKey).map(k=>byKey[k]).sort((a,b)=>b.minutes-a.minutes),sessions:list};
}

/* ============================================================
   MODULE PRÉVISIONS : créneaux planifiés
   ============================================================ */
function planOccKey(planId,date,time){ return 'plan|'+planId+'|'+date+'|'+(time||'--:--'); }
function planOccurrences(from,to,opt){
  opt=opt||{};
  if(!state.settings.modules.planning) return [];
  const floor=state.settings.planning.floorDate||isoToday();
  const lo=maxYMD(from,floor);
  const decided={}; (state.planOccs||[]).forEach(o=>decided[o.key]=o);
  const out=[];
  const push=(p,d)=>{
    const key=planOccKey(p.id,d,p.time), dec=decided[key];
    if(opt.onlyUndecided&&dec) return;
    out.push({key:key,planId:p.id,date:d,time:p.time,activityKey:p.activityKey,
      label:p.label||actLabel(p.activityKey),place:p.place||'',durationMin:p.durationMin,
      emoji:actEmoji(p.activityKey),color:actColor(p.activityKey),
      status:dec?dec.status:'undecided',sessionId:dec?dec.sessionId:null,
      isPast:(d<isoToday())||(d===isoToday()&&p.time&&hhmmToMin(p.time)<nowMin())});
  };
  (state.plans||[]).forEach(p=>{
    if(p.active===false) return;
    if(p.kind==='oneoff'){ if(p.date&&p.date>=lo&&p.date<=to) push(p,p.date); return; }
    const s=maxYMD(p.startDate||floor,lo);
    const end=p.endDate?(p.endDate<to?p.endDate:to):to;
    let d=s,guard=0;
    const anchorWk=weekStartYMD(p.startDate||floor);
    while(d<=end&&guard++<800){
      if((p.weekdays||[]).indexOf(isoDow(d))>=0){
        const wkIdx=Math.round(diffDays(anchorWk,weekStartYMD(d))/7);
        if((p.everyNWeeks||1)<=1||wkIdx%p.everyNWeeks===0) push(p,d);
      }
      d=addDayYMD(d,1);
    }
  });
  out.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:String(a.time).localeCompare(String(b.time)));
  return out;
}
function plannedToday(){ return planOccurrences(isoToday(),isoToday()).filter(o=>o.status!=='skipped'); }
function nextPlannedDays(n){ const t=isoToday();
  return planOccurrences(t,addDayYMD(t,n||state.settings.planning.horizonDays||14)); }
function pendingConfirm(){
  const t=isoToday(), h=state.settings.planning.confirmWindowH||36;
  const from=addDayYMD(t,-Math.ceil(h/24)-1);
  return planOccurrences(from,t).filter(o=>o.status==='undecided'&&o.isPast);
}
function setPlanOcc(key,status,sessionId){
  state.planOccs=state.planOccs||[];
  const parts=key.split('|');
  const i=state.planOccs.findIndex(o=>o.key===key);
  const rec={key:key,planId:parts[1],date:parts[2],time:parts[3],status:status,
    sessionId:sessionId||null,decidedAt:new Date().toISOString()};
  if(i>=0) state.planOccs[i]=rec; else state.planOccs.push(rec);
}
function clearPlanOcc(key){ state.planOccs=(state.planOccs||[]).filter(o=>o.key!==key); }
/* Une séance saisie librement le jour d'un créneau prévu le valide automatiquement. */
function autoLinkPlan(s){
  if(!state.settings.modules.planning) return;
  const occ=planOccurrences(s.date,s.date).filter(o=>o.status==='undecided'&&o.activityKey===s.activityKey);
  if(occ.length===1){ s.planKey=occ[0].key; setPlanOcc(occ[0].key,'done',s.id); }
}
function hasTrainingOnDay(d){
  if(!state.settings.modules.sport) return false;
  if(sessionsOnDay(d).length) return true;
  return planOccurrences(d,d).some(o=>o.status!=='skipped');
}

/* ---------- Écran : Sport ---------- */
/* Trois onglets, trois questions distinctes : ce que j'ai fait, ce que je vais faire,
   et avec quoi. Avant, ces trois choses étaient réparties sur trois écrans qui se
   renvoyaient l'un à l'autre — personne ne savait plus où chercher quoi. */
const SPORT_TABS=[['seances','dumbbell','Mes séances','/sport'],
                  ['planning','calendar','Mon planning','/planning'],
                  ['activites','settings','Mes activités','/activites']];
function screenSport(tab){
  tab=SPORT_TABS.some(t=>t[0]===tab)?tab:'seances';
  if(!state.settings.modules.sport){ return backHead('Sport','/plus')
    +empty('run','Le module sport est désactivé','Active-le pour noter tes séances, prévoir tes créneaux et voir ton calendrier d’entraînement. Rien n’a été perdu.',
      '<button class="btn btn--primary" data-act="mod-on" data-k="sport">Activer le sport</button>'); }
  const act=tab==='seances'?'<button class="btn-add" data-act="new-session">+ Séance</button>'
    :tab==='planning'?'<button class="btn-add" data-act="new-plan">+ Créneau</button>'
    :'<button class="btn-add" data-act="new-activity">+ Activité</button>';
  let h=backHead('Sport','/plus',act);
  h+='<div class="subtabs">'+SPORT_TABS.map(t=>
    '<button class="subtab'+(tab===t[0]?' is-active':'')+'" data-act="go" data-route="'+t[3]+'">'+ic(t[1],'ic--sm')+esc(t[2])
    +(t[0]==='planning'&&pendingConfirm().length?'<span class="pastille--num">'+pendingConfirm().length+'</span>':'')
    +'</button>').join('')+'</div>';
  if(tab==='planning') return h+sportPlanningView();
  if(tab==='activites') return h+sportActivitiesView();
  return h+sportSessionsView();
}
function sportSessionsView(){
  const per=state.ui.sportPeriod||7;
  const st=sportStats(per==='year'?'year':per);
  const wg=weeklyGoal();
  let h=segHTML([[7,'7 jours'],[30,'30 jours'],['year','Cette année']],String(per),'sport-period','');
  const kcalOn=state.settings.sport.kcalMode!=='off';
  h+='<div class="stats'+(kcalOn?'':' stats-2')+'" style="margin-top:12px">'
   +statCard('Séances',String(st.count),'','')
   +statCard('Temps',fmtMin(st.minutes),'','')
   +(kcalOn?statCard('≈ kcal',nf(st.kcal,0),'estimation',''):'')
   +'</div>';
  if(wg.goalMin||wg.goalSessions){
    h+='<div class="card" style="margin-top:12px"><div class="goal-ring-wrap">'
     +ringHTML(wg.pct,{size:76,stroke:9,color:'var(--acc)',center:'<span style="font-size:13px">'+Math.round(wg.pct*100)+' %</span>'})
     +'<div style="flex:1;min-width:0"><div class="row-title">Objectif de la semaine</div>'
     +'<div class="stat-label" style="margin-top:1px">depuis lundi</div>'
     +'<div class="small muted" style="margin-top:2px">'
     +(wg.hit?'<span class="down">Objectif atteint ✓ '+fmtMin(wg.minutes)+'</span>'
             :fmtMin(wg.minutes)+' sur '+fmtMin(wg.goalMin)+(wg.restMin?' · encore '+fmtMin(wg.restMin):''))+'</div>'
     +(wg.goalSessions?'<div class="small muted">'+wg.count+' '+plural(wg.count,'séance')+' sur '+wg.goalSessions+'</div>':'')
     +'<button class="btn-add" data-act="edit-weekly-goal" style="margin-top:4px">Régler l’objectif</button>'
     +'</div></div></div>';
  }
  const sw=streakWeeks(), sd=sportStreakDays();
  if(sw>0||sd>1){
    h+='<div class="card" style="margin-top:12px"><div class="row-title flex aic gap8">'+ic('bolt','ic--sm')+'Régularité</div>'
     +'<div class="small muted" style="margin-top:4px">'+(sw>0?sw+' '+plural(sw,'semaine')+' d’affilée avec au moins une séance.':'')
     +(sd>1?' '+sd+' jours d’affilée.':'')+'</div></div>';
  }
  h+=sportCalendar();
  h+=sportSplitBars(st.sessions);
  const last=(state.sessions||[]).slice().sort((a,b)=>a.date<b.date?1:-1).slice(0,10);
  if(last.length){
    h+='<div class="section-title">Dernières séances</div><div class="list">'
     +last.map(s=>'<div class="row" data-act="edit-session" data-id="'+s.id+'">'
       +'<div class="row-ic" style="background:color-mix(in srgb,'+actColor(s.activityKey)+' 22%,var(--bg-3))">'+uem(actEmoji(s.activityKey))+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(actLabel(s.activityKey))+'</div>'
       +'<div class="row-sub">'+esc(capit(fmtDayLabel(s.date)))+' <span class="pill">'+fmtMin(s.durationMin)+'</span>'
       +(s.kcal?'<span class="pill">≈ '+nf(s.kcal,0)+' kcal</span>':'')+'</div></div>'+arrowHTML()+'</div>').join('')
     +'</div>';
  } else h+=empty('dumbbell','Aucune séance pour l’instant','Note ta première séance : marche, muscu, badminton… tout compte.',
      '<button class="btn btn--primary" data-act="new-session">+ Noter une séance</button>');
  return h;
}
function sportStreakDays(){
  let d=isoToday(); if(!sessionsOnDay(d).length) d=addDayYMD(d,-1);
  let n=0,guard=0; while(guard++<400&&sessionsOnDay(d).length){ n++; d=addDayYMD(d,-1); }
  return n;
}
function sportCalendar(){
  const mk=state.ui.sportMonth||monthKey(isoToday());
  const y=+mk.slice(0,4), m=+mk.slice(5,7)-1;
  const first=ymd(new Date(y,m,1)), nDays=daysInMonth(y,m);
  const off=(parseYMD(first).getDay()+6)%7;
  const byDay={}; (state.sessions||[]).forEach(s=>{ if(monthKey(s.date)===mk){ (byDay[s.date]||(byDay[s.date]=[])).push(s); } });
  const planned={}; planOccurrences(first,addDayYMD(first,nDays-1)).forEach(o=>{ planned[o.date]=true; });
  let cells='';
  for(let i=0;i<off;i++) cells+='<div class="cal-day out"></div>';
  for(let d=1;d<=nDays;d++){
    const ds=mk+'-'+String(d).padStart(2,'0');
    const ss=byDay[ds]||[];
    const keys=[]; ss.forEach(s=>{ if(keys.indexOf(s.activityKey)<0) keys.push(s.activityKey); });
    const dots=keys.slice(0,3).map((k,i)=>i===2&&keys.length>3
      ?'<span class="dot" style="border:1px solid var(--tx-3)"></span>'
      :'<span class="dot" style="background:'+actColor(k)+'"></span>').join('');
    const cls='cal-day'+(ss.length?' sel':'')+(ds===isoToday()?' today':'');
    cells+='<div class="'+cls+'" data-act="sport-day" data-date="'+ds+'">'+d
      +'<div class="cal-dots">'+dots+(!ss.length&&planned[ds]?'<span class="dot" style="border:1px solid var(--m-sport)"></span>':'')+'</div></div>';
  }
  const minutes=(state.sessions||[]).filter(s=>monthKey(s.date)===mk).reduce((a,x)=>a+(x.durationMin||0),0);
  const days=Object.keys(byDay).length;
  const moisCourant=mk===monthKey(isoToday());
  return '<div class="card" style="margin-top:12px"><div class="cal-head">'
   +'<button class="chip" data-act="sport-month" data-d="-1">‹</button>'
   +(moisCourant?'<b style="text-transform:capitalize">'+esc(fmtMonth(mk))+'</b>'
     :'<button class="chip" data-act="sport-month-today" style="text-transform:capitalize">'+esc(fmtMonth(mk))+' · revenir</button>')
   +(mk>=monthKey(isoToday())?'<span class="chip" style="opacity:.35">›</span>':'<button class="chip" data-act="sport-month" data-d="1">›</button>')
   +'</div>'
   +'<div class="cal-grid">'+['L','M','M','J','V','S','D'].map(d=>'<div class="cal-dow">'+d+'</div>').join('')+cells+'</div>'
   +'<div class="small muted center" style="margin-top:8px">'+days+' '+plural(days,'jour')+' '+plural(days,'entraîné')+' · '+fmtMin(minutes)+' ce mois-ci</div></div>';
}
function openSportDaySheet(date){
  const ss=sessionsOnDay(date);
  const occ=planOccurrences(date,date);
  let h='';
  if(ss.length) h+='<div class="list">'+ss.map(s=>'<div class="row" data-act="edit-session" data-id="'+s.id+'">'
    +'<div class="row-ic row-ic--emoji">'+uem(actEmoji(s.activityKey))+'</div><div class="row-main"><div class="row-title">'+esc(actLabel(s.activityKey))+'</div>'
    +'<div class="row-sub"><span class="pill">'+fmtMin(s.durationMin)+'</span>'+(s.kcal?'<span class="pill">≈ '+nf(s.kcal,0)+' kcal</span>':'')+'</div></div>'+arrowHTML()+'</div>').join('')+'</div>';
  occ.filter(o=>o.status==='undecided').forEach(o=>{
    h+='<div class="card" style="margin-bottom:10px"><div class="row-title">Prévu : '+esc(o.label)+(o.time?' à '+esc(o.time):'')+'</div>'
      +'<div class="btn-row" style="margin-top:10px">'
      +'<button class="btn btn--primary" data-act="plan-done" data-key="'+esc(o.key)+'">C’est fait</button>'
      +'<button class="btn btn--ghost" data-act="plan-skip" data-key="'+esc(o.key)+'">Pas cette fois</button></div></div>';
  });
  if(!ss.length&&!occ.length) h+='<p class="muted small center">Aucune séance ce jour-là.</p>';
  h+='<button class="btn btn--primary btn--block" data-act="new-session" data-date="'+date+'" style="margin-top:10px">+ Séance ce jour-là</button>';
  openSheet(capit(fmtDayLabel(date)),h);
}
function weeklyGoalSheet(){
  const s=state.settings.sport;
  openSheet('Objectif de la semaine',
    '<div class="field"><label>Minutes par semaine</label><input class="input tnum" id="wgMin" inputmode="numeric" value="'+(s.weeklyGoalMin||0)+'">'
    +'<div class="chip-row" style="margin-top:8px">'+[90,150,210,300].map(m=>'<button class="chip" data-act="wg-preset" data-m="'+m+'">'+m+' min</button>').join('')+'</div></div>'
    +'<div class="field"><label>Séances par semaine</label><input class="input tnum" id="wgSes" inputmode="numeric" value="'+(s.weeklyGoalSessions||0)+'"></div>'
    +'<div class="hint">L’OMS conseille 150 min d’activité modérée par semaine. Mets ce qui te ressemble : un objectif tenable vaut mieux qu’un objectif parfait.</div>'
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="wg-save">Enregistrer</button></div>');
}

/* ---------- Onglet : Planning (ce qui est prévu) ---------- */
function sportPlanningView(){
  let h='';
  if(!state.settings.modules.planning){
    h+='<div class="card"><div class="row-title flex aic gap8">'+ic('calendar','ic--sm')+'Prévoir tes entraînements</div>'
     +'<div class="small muted" style="margin:6px 0 12px">Note tes créneaux habituels (badminton le mardi à 20h, muscu lundi et jeudi…). Élan te les rappellera le jour venu, histoire de te préparer psychologiquement.</div>'
     +'<button class="btn btn--primary btn--block" data-act="mod-on" data-k="planning">Activer les prévisions</button></div>';
    return h;
  }
  const pend=pendingConfirm();
  if(pend.length){
    h+='<div class="section-title">À confirmer</div><div class="list">'
     +pend.map(o=>'<div class="row"><div class="row-ic row-ic--emoji">'+uem(o.emoji)+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(o.label)+'</div>'
       +'<div class="row-sub">'+esc(capit(fmtDayLabel(o.date)))+(o.time?' · '+esc(o.time):'')+'</div></div>'
       +'<div class="med-acts"><button class="chip chip--act is-active" data-act="plan-done" data-key="'+esc(o.key)+'">Fait</button>'
       +'<button class="chip chip--act" data-act="plan-skip" data-key="'+esc(o.key)+'">Non</button></div></div>').join('')
     +'</div>';
  }
  const next=nextPlannedDays(14).filter(o=>o.status==='undecided'&&!o.isPast);
  h+='<div class="section-title">À venir</div>';
  if(!next.length) h+='<div class="card"><div class="small muted">Rien de prévu dans les deux prochaines semaines.</div></div>';
  else{
    /* On ne liste que les prochaines séances : avec un créneau quotidien, afficher
       les quatorze occurrences n'apprend rien de plus et noie l'écran. */
    const SHOWN=5, shown=next.slice(0,SHOWN), rest=next.length-shown.length;
    let curDate=null; h+='<div class="list">';
    shown.forEach(o=>{
      if(o.date!==curDate){ curDate=o.date; h+='<div class="day-head">'+esc(capit(fmtDayLabel(o.date)))+'</div>'; }
      h+='<div class="row" data-act="edit-plan" data-id="'+o.planId+'"><div class="row-ic row-ic--emoji">'+uem(o.emoji)+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(o.label)+'</div>'
       +'<div class="row-sub">'+(o.time?'<span class="pill">'+esc(o.time)+'</span>':'')
       +(o.durationMin?'<span class="pill">'+fmtMin(o.durationMin)+'</span>':'')
       +(o.place?'<span class="pill">'+esc(o.place)+'</span>':'')+'</div></div>'+arrowHTML()+'</div>';
    });
    h+='</div>';
    if(rest>0) h+='<div class="small muted center" style="margin:-2px 4px 0">et '+rest+' '+plural(rest,'autre')
      +' dans les 14 prochains jours</div>';
  }
  h+='<div class="section-title">Mes créneaux</div>';
  const plans=(state.plans||[]).slice().sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  if(!plans.length) h+=empty('calendar','Aucun créneau','Ajoute tes rendez-vous sportifs habituels pour qu’ils s’affichent le jour venu.',
    '<button class="btn btn--primary" data-act="new-plan">+ Ajouter un créneau</button>');
  else h+='<div class="list">'+plans.map(p=>'<div class="row" data-act="edit-plan" data-id="'+p.id+'">'
    +'<div class="row-ic row-ic--emoji">'+uem(actEmoji(p.activityKey))+'</div>'
    +'<div class="row-main"><div class="row-title">'+esc(p.label||actLabel(p.activityKey))+'</div>'
    +'<div class="row-sub">'+esc(planRecLabel(p))+' · '+esc(p.time||'')+(p.durationMin?' · '+fmtMin(p.durationMin):'')
    +(p.active===false?' <span class="badge badge--miss">en pause</span>':'')+'</div></div>'+arrowHTML()+'</div>').join('')+'</div>';
  const adh=planAdherence();
  if(adh) h+='<div class="card" style="margin-top:12px"><div class="small muted">Sur 30 jours : '+adh.done+' '+plural(adh.done,'séance')
    +' réalisée'+(adh.done>1?'s':'')+' sur '+adh.total+' prévue'+(adh.total>1?'s':'')+'. On ne compte pas les points, on regarde la tendance.</div></div>';
  h+='<div class="hint" style="margin-top:12px">Un créneau, c’est une <b>intention</b>. Une séance, c’est ce que tu as <b>fait</b>. Confirme une prévision et elle devient une séance dans l’onglet précédent.</div>';
  return h;
}
function planRecLabel(p){
  if(p.kind==='oneoff') return p.date?capit(fmtDateLong(p.date)):'Ponctuel';
  const d=(p.weekdays||[]).slice().sort((a,b)=>a-b);
  const names=['','lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  let base;
  if(!d.length) base='Aucun jour';
  else if(d.length===7) base='Tous les jours';
  else if(d.length===5&&[1,2,3,4,5].every(x=>d.indexOf(x)>=0)) base='En semaine';
  else if(d.length===2&&d.indexOf(6)>=0&&d.indexOf(7)>=0) base='Le week-end';
  else base=d.map(x=>names[x]).join(', ');
  if((p.everyNWeeks||1)>1) base+=' · 1 semaine sur '+p.everyNWeeks;
  return capit(base);
}
function planAdherence(){
  if(!state.settings.modules.planning) return null;
  const from=addDayYMD(isoToday(),-29);
  const occ=planOccurrences(from,isoToday()).filter(o=>o.isPast||o.date<isoToday());
  if(!occ.length) return null;
  return {total:occ.length,done:occ.filter(o=>o.status==='done').length};
}
let PF=null;
function planEditor(id){
  const p=id?(state.plans||[]).find(x=>x.id===id):null;
  PF=p?Object.assign({},p,{weekdays:(p.weekdays||[]).slice()}):{
    id:null,kind:'recurring',activityKey:state.ui.lastActivityKey||'badminton',label:'',place:'',
    time:'18:30',durationMin:60,weekdays:[isoDow(isoToday())],everyNWeeks:1,
    startDate:isoToday(),endDate:null,date:null,active:true};
  openSheet(p?'Modifier le créneau':'Nouveau créneau',planEditorBody());
}
function planEditorBody(){
  const acts=activeActivities();
  let h=segHTML([['recurring','Récurrent'],['oneoff','Ponctuel']],PF.kind,'pf-kind','');
  h+='<div class="field" style="margin-top:12px"><label>Activité</label><div class="chip-row">'
   +acts.map(a=>'<button class="chip'+(a.key===PF.activityKey?' is-active':'')+'" data-act="pf-act" data-key="'+a.key+'">'+uem(a.emoji)+' '+esc(a.label)+'</button>').join('')
   +'</div></div>';
  if(PF.kind==='recurring'){
    const names=['L','M','M','J','V','S','D'];
    h+='<div class="field"><label>Quels jours ?</label><div class="chip-wrap">'
     +names.map((n,i)=>{ const iso=i+1;
       return '<button class="chip'+(PF.weekdays.indexOf(iso)>=0?' is-active':'')+'" data-act="pf-dow" data-n="'+iso+'" style="min-width:44px">'+n+'</button>'; }).join('')
     +'</div></div>'
     +'<div class="field"><label>Fréquence</label>'+segHTML([[1,'Chaque semaine'],[2,'1 sur 2'],[3,'1 sur 3']],String(PF.everyNWeeks||1),'pf-every','')+'</div>'
     +'<div class="row-2"><div class="field"><label>À partir du</label><input class="input" type="date" id="pfStart" value="'+(PF.startDate||isoToday())+'"></div>'
     +'<div class="field"><label>Jusqu’au (facultatif)</label><input class="input" type="date" id="pfEnd" value="'+(PF.endDate||'')+'"></div></div>';
  } else {
    h+='<div class="field"><label>Date</label><input class="input" type="date" id="pfDate" value="'+(PF.date||isoToday())+'"></div>';
  }
  h+='<div class="row-2"><div class="field"><label>Heure</label><input class="input" type="time" id="pfTime" value="'+(PF.time||'18:30')+'"></div>'
   +'<div class="field"><label>Durée (min)</label><input class="input tnum" id="pfDur" inputmode="numeric" value="'+(PF.durationMin||60)+'"></div></div>'
   +'<div class="field"><label>Nom (facultatif)</label><input class="input" id="pfLabel" value="'+esc(PF.label||'')+'" placeholder="Ex. : Badminton au club"></div>'
   +'<div class="field"><label>Lieu (facultatif)</label><input class="input" id="pfPlace" value="'+esc(PF.place||'')+'" placeholder="Ex. : Gymnase Jean-Moulin"></div>'
   +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="pf-save">Enregistrer</button>'
   +(PF.id?'<button class="btn btn--danger btn--block" data-act="pf-del" data-id="'+PF.id+'" style="margin-top:8px">Supprimer ce créneau</button>':'')
   +'</div>';
  return h;
}
function savePlan(){
  const g=id=>{ const el=document.getElementById(id); return el?el.value:''; };
  PF.time=g('pfTime')||'18:30';
  PF.durationMin=clamp(parseInt(g('pfDur'),10)||60,5,600);
  PF.label=(g('pfLabel')||'').trim();
  PF.place=(g('pfPlace')||'').trim();
  if(PF.kind==='recurring'){
    PF.startDate=g('pfStart')||isoToday(); PF.endDate=g('pfEnd')||null; PF.date=null;
    if(!PF.weekdays.length){ toast('Choisis au moins un jour'); return; }
  } else { PF.date=g('pfDate')||isoToday(); }
  const now=new Date().toISOString();
  if(PF.id){ const p=(state.plans||[]).find(x=>x.id===PF.id); Object.assign(p,PF,{updatedAt:now}); }
  else { state.plans.push(Object.assign({},PF,{id:uid(),createdAt:now,updatedAt:now})); }
  if(!state.settings.modules.planning){ state.settings.modules.planning=true; state.settings.planning.floorDate=isoToday(); }
  closeSheet(); update(); toast('Créneau enregistré ✓'); PF=null;
}
function deletePlan(id){
  confirmSheet('Supprimer ce créneau','Le créneau et ses pointages seront supprimés. Les séances déjà enregistrées sont conservées.',()=>{
    const i=(state.plans||[]).findIndex(x=>x.id===id); if(i<0) return;
    const p=state.plans[i]; const occs=(state.planOccs||[]).filter(o=>o.planId===id);
    state.plans.splice(i,1); state.planOccs=(state.planOccs||[]).filter(o=>o.planId!==id);
    (state.sessions||[]).forEach(s=>{ if(s.planKey&&s.planKey.indexOf('|'+id+'|')>=0) s.planKey=null; });
    closeSheet(); update();
    toast('Créneau supprimé',()=>{ state.plans.splice(i,0,p); state.planOccs=state.planOccs.concat(occs); update(); });
  },true,'Supprimer');
}

/* ---------- Écran : Activités ---------- */
/* ---------- Onglet : Activités (le catalogue) ---------- */
function sportActivitiesView(){
  const on=activeActivities(), off=(state.activities||[]).filter(a=>a.archived);
  const st=sportStats('year');
  const used={}; st.byActivity.forEach(b=>used[b.key]=b);
  let h='<div class="hint" style="margin:10px 4px 12px">Ce sont les activités proposées quand tu notes une séance. Touche l’une d’elles pour changer son nom, sa durée habituelle ou son intensité.</div>';
  h+='<div class="section-title">Actives</div><div class="list">'
   +on.map(a=>{ const u=used[a.key];
     return '<div class="row" data-act="edit-activity" data-key="'+a.key+'">'
      +'<div class="row-ic row-ic--emoji" style="background:color-mix(in srgb,'+a.color+' 20%,var(--bg-3))">'+uem(a.emoji)+'</div>'
      +'<div class="row-main"><div class="row-title">'+esc(a.label)+'</div>'
      +'<div class="row-sub"><span class="pill">'+(a.defaultDurationMin||45)+' min</span>'
      +'<span class="pill">MET '+nf(a.met,1)+'</span>'
      +(u?'<span>'+u.count+' '+plural(u.count,'séance')+' cette année</span>':'<span class="muted">jamais utilisée</span>')
      +'</div></div>'+arrowHTML()+'</div>'; }).join('')+'</div>';
  if(off.length) h+='<div class="section-title">Masquées</div><div class="chip-wrap">'
   +off.map(a=>'<button class="chip chip--act" style="opacity:.5" data-act="edit-activity" data-key="'+a.key+'">'+uem(a.emoji)+' '+esc(a.label)+'</button>').join('')+'</div>';
  h+='<button class="btn btn--ghost btn--block" data-act="new-activity" style="margin-top:12px">+ Créer une activité</button>';
  h+='<div class="hint" style="margin-top:12px">Masquer une activité la retire des listes de saisie, sans toucher aux séances déjà enregistrées.</div>';
  return h;
}
let AF=null;
function activityEditor(key){
  const a=key?actByKey(key):null;
  AF=a?Object.assign({},a):{key:null,label:'',emoji:'✨',color:'#8A97AD',met:5,metLow:null,metHigh:null,
    defaultIntensity:'moyenne',defaultDurationMin:45,tracksDistance:false,isDefault:false,archived:false};
  openSheet(a?'Modifier l’activité':'Nouvelle activité',activityEditorBody());
}
function activityEditorBody(){
  let h='<div class="row-2"><div class="field"><label>Émoji</label><input class="input" id="acEmoji" maxlength="4" value="'+esc(AF.emoji)+'"></div>'
   +'<div class="field"><label>Couleur</label><input class="input" type="color" id="acColor" value="'+esc(AF.color)+'"></div></div>'
   +'<div class="field"><label>Nom</label><input class="input" id="acLabel" value="'+esc(AF.label)+'" placeholder="Ex. : Padel"></div>'
   +'<div class="field"><label>Intensité par défaut</label>'+segHTML([['faible','Tranquille'],['moyenne','Normale'],['forte','Intense']],AF.defaultIntensity,'ac-int','')+'</div>'
   +'<div class="row-2"><div class="field"><label>Durée par défaut (min)</label><input class="input tnum" id="acDur" inputmode="numeric" value="'+(AF.defaultDurationMin||45)+'"></div>'
   +'<div class="field"><label>Effort (MET)</label><input class="input tnum" id="acMet" inputmode="decimal" value="'+(AF.met||5)+'"></div></div>'
   +'<div class="hint">Le MET sert à estimer les calories brûlées. 3 = doux, 6 = soutenu, 10 = intense. Laisse tel quel si tu ne sais pas.</div>'
   +toggleHTML('Suivre la distance (km)',!!AF.tracksDistance,'ac-dist')
   +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="ac-save">Enregistrer</button>'
   +(AF.key?('<button class="btn btn--ghost btn--block" data-act="ac-archive" data-key="'+AF.key+'" style="margin-top:8px">'
      +(AF.archived?'Réafficher cette activité':'Masquer cette activité')+'</button>'):'')
   +'</div>';
  return h;
}
function saveActivity(){
  const g=id=>{ const el=document.getElementById(id); return el?el.value:''; };
  const label=(g('acLabel')||'').trim();
  if(!label){ toast('Donne un nom à l’activité'); return; }
  AF.label=label; AF.emoji=(g('acEmoji')||'✨').slice(0,4); AF.color=g('acColor')||'#8A97AD';
  AF.defaultDurationMin=clamp(parseInt(g('acDur'),10)||45,5,600);
  AF.met=clamp(parseNum(g('acMet'))||5,1,20);
  const now=new Date().toISOString();
  if(AF.key){ const a=actByKey(AF.key); Object.assign(a,AF,{updatedAt:now}); }
  else{
    let k=slugify(label), n=2;
    while(actByKey(k)) k=slugify(label)+'-'+(n++);
    state.activities.push(Object.assign({},AF,{key:k,sortOrder:state.activities.length,usageCount:0,lastUsedAt:null,createdAt:now,updatedAt:now}));
  }
  closeSheet(); update(); toast('Activité enregistrée ✓'); AF=null;
}

/* ============================================================
   MODULE PILULIER
   ------------------------------------------------------------
   On ne stocke QUE des décisions : la liste des prises attendues
   d'un jour est toujours dérivée. Trois règles produit :
   - une prise ancrée sur l'entraînement n'est PAS rappelée les
     jours sans séance (et ne compte pas dans l'observance),
     mais reste cochable d'un tap ;
   - un groupe d'alternatives (la protéine : au goûter OU après
     la séance) ne produit QU'UNE ligne, et une seule validation ;
   - rien de rétroactif avant l'activation du module.
   ============================================================ */
const MED_KINDS=[
  ['medicament','Médicament','💊','hsl(0 62% 60%)'],
  ['complement','Complément','🧪','hsl(190 62% 56%)'],
  ['proteine','Protéine','🥤','hsl(150 62% 56%)'],
  ['vitamine','Vitamine','🍊','hsl(35 72% 58%)'],
  ['autre','Autre','📦','hsl(265 55% 62%)']];
function medKindLabel(k){ const f=MED_KINDS.find(x=>x[0]===k); return f?f[1]:'Autre'; }
function medKindIcon(k){ const f=MED_KINDS.find(x=>x[0]===k); return f?f[2]:'📦'; }
function medKindColor(k){ const f=MED_KINDS.find(x=>x[0]===k); return f?f[3]:'hsl(265 55% 62%)'; }
function medById(id){ return (state.meds||[]).find(m=>m.id===id)||null; }
function schedById(id){ return (state.medSchedules||[]).find(s=>s.id===id)||null; }
function groupById(id){ return (state.medGroups||[]).find(g=>g.id===id)||null; }
function medKey(date,ref){ return date+'|'+ref; }
const MOMENT_ORDER=['matin','midi','gouter','soir','coucher','peuimporte'];
const MOMENT_LABEL={matin:'Matin',midi:'Midi',gouter:'Goûter',soir:'Soir',coucher:'Au coucher',peuimporte:'Quand tu veux'};
const MEAL_LABEL={petitdej:'petit-déjeuner',dejeuner:'déjeuner',gouter:'goûter',diner:'dîner'};
const ANY_MIN=1441;
const PILL_PERIODS=[['MATIN',0,11*60],['MIDI',11*60,14*60+30],['APRÈS-MIDI',14*60+30,17*60+30],
  ['SOIR',17*60+30,21*60+30],['NUIT',21*60+30,1440],['QUAND TU VEUX',ANY_MIN,ANY_MIN+1]];
function pillPeriodOf(m){ const f=PILL_PERIODS.find(p=>m>=p[1]&&m<p[2]); return f?f[0]:'QUAND TU VEUX'; }

/* Jour « logique » : une prise du coucher validée à 00h30 compte sur la journée écoulée. */
function pillToday(){
  const d=new Date(), cut=state.settings.pillbox.dayCutoffHour||0;
  if(d.getHours()<cut) d.setDate(d.getDate()-1);
  return ymd(d);
}
/* Contexte d'entraînement d'un jour : y a-t-il une séance, et quand se termine-t-elle ? */
function pillWorkoutCtx(date){
  const out={any:false,planned:false,done:false,startTime:null,durationMin:null,endTime:null,label:null};
  if(!state.settings.modules.sport) return out;
  const done=sessionsOnDay(date);
  const plans=planOccurrences(date,date).filter(o=>o.status!=='skipped');
  const src=done.length?done:plans;
  if(!src.length) return out;
  const pick=src.slice().sort((a,b)=>String(a.time||'99:99')>String(b.time||'99:99')?1:-1).pop();
  out.any=true; out.done=done.length>0; out.planned=plans.length>0;
  out.startTime=pick.time||null;
  out.durationMin=pick.durationMin!=null?pick.durationMin:null;
  out.label=pick.label||actLabel(pick.activityKey)||'Séance';
  const P=state.settings.pillbox;
  const st=out.startTime||P.defaultWorkoutTime;
  const dur=out.durationMin!=null?out.durationMin:P.defaultSessionMin;
  out.endTime=minToHHMM(hhmmToMin(st)+dur);
  return out;
}
function pillOccursOn(sc,date){
  if(!sc.active) return false;
  if(sc.startDate&&date<sc.startDate) return false;
  if(sc.endDate&&date>sc.endDate) return false;
  const p=medById(sc.productId);
  if(!p||!p.active||p.archived) return false;
  if(p.startDate&&date<p.startDate) return false;
  if(p.endDate&&date>p.endDate) return false;
  const r=sc.recurrence||{type:'daily'};
  if(r.type==='asNeeded') return false;
  if(r.type==='daily') return true;
  if(r.type==='weekdays') return Array.isArray(r.days)&&r.days.indexOf(dowOf(date))>=0;
  if(r.type==='everyNDays'){
    const n=Math.max(2,r.n||2), a=r.anchorDate||sc.startDate;
    if(!a||date<a) return false;
    return diffDays(a,date)%n===0;
  }
  return false;
}
/* Heure estimée : « X min APRÈS l'entraînement » s'ancre sur la FIN de séance. */
function pillEstMin(sc,date,wctx){
  const P=state.settings.pillbox, a=sc.anchor||{};
  if(a.type==='time') return hhmmToMin(a.time||'08:00');
  if(a.type==='moment'){ if(a.moment==='peuimporte') return ANY_MIN; return hhmmToMin(P.momentTimes[a.moment]||'08:00'); }
  if(a.type==='meal'){
    const base=hhmmToMin(P.mealTimes[a.meal]||'12:30'), off=Math.max(0,a.offsetMin||0);
    return clamp(a.dir==='before'?base-off:base+off,0,1439);
  }
  if(a.type==='workout'){
    const w=wctx||pillWorkoutCtx(date);
    const st=w.startTime||P.defaultWorkoutTime;
    const en=w.endTime||minToHHMM(hhmmToMin(st)+P.defaultSessionMin);
    const base=a.dir==='before'?hhmmToMin(st):hhmmToMin(en), off=Math.max(0,a.offsetMin||0);
    return clamp(a.dir==='before'?base-off:base+off,0,1439);
  }
  return ANY_MIN;
}
function pillWhenLabel(sc){
  if(sc.label) return sc.label;
  const a=sc.anchor||{};
  if(a.type==='time') return 'À '+(a.time||'08:00');
  if(a.type==='moment') return MOMENT_LABEL[a.moment]||'Matin';
  const dir=a.dir==='before'?'avant':'après';
  const off=Math.max(0,a.offsetMin||0);
  const pre=off===0?(a.dir==='before'?'Juste avant':'Juste après'):(off+' min '+dir);
  if(a.type==='meal') return pre+' le '+(MEAL_LABEL[a.meal]||'déjeuner');
  if(a.type==='workout') return pre+' la séance';
  return 'Quand tu veux';
}
function pillTimeLabel(estMin,sc,wctx){
  if(estMin===ANY_MIN) return 'quand tu veux';
  const t=minToHHMM(estMin);
  if(sc.anchor&&sc.anchor.type==='workout') return (wctx&&wctx.startTime)?('vers '+t):('vers '+t+' (estimé)');
  if(sc.anchor&&sc.anchor.type==='time') return t;
  return 'vers '+t;
}
function pillRecLabel(sc){
  const r=sc.recurrence||{type:'daily'};
  if(r.type==='daily') return 'Tous les jours';
  if(r.type==='everyNDays') return r.n===2?'Un jour sur deux':('Tous les '+r.n+' jours');
  if(r.type==='asNeeded') return 'Au besoin';
  const order=[1,2,3,4,5,6,0];
  const d=(r.days||[]).slice().sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  if(!d.length) return 'Aucun jour';
  if(d.length===7) return 'Tous les jours';
  if(d.length===5&&[1,2,3,4,5].every(x=>d.indexOf(x)>=0)) return 'En semaine';
  if(d.length===2&&d.indexOf(0)>=0&&d.indexOf(6)>=0) return 'Le week-end';
  return capit(d.map(x=>JOURS[x]).join(', '));
}
function mkSlot(sc,p,date,wctx,intake,o){
  o=o||{};
  const estMin=pillEstMin(sc,date,wctx);
  return {key:medKey(date,o.groupId||sc.id),kind:o.groupId?'group':'single',
    date:date,productId:p.id,product:p,scheduleId:sc.id,schedule:sc,
    groupId:o.groupId||null,group:o.group||null,alts:o.alts||[],
    estMin:estMin,timeLabel:pillTimeLabel(estMin,sc,wctx),whenLabel:pillWhenLabel(sc),recLabel:pillRecLabel(sc),
    conditional:!!o.conditional,eligible:o.eligible!==false,onDemand:!!o.onDemand,
    extra:!!o.extra,anyway:!!o.anyway,
    status:intake?intake.status:'pending',intake:intake||null,late:false,
    dose:(intake&&intake.qty)||sc.qty||p.dose||''};
}
function pillCarrier(usable,date,wctx,isToday){
  if(usable.length===1) return usable[0];
  const nm=isToday?nowMin():0;
  const withMin=usable.map(sc=>({sc:sc,m:pillEstMin(sc,date,wctx)})).sort((a,b)=>a.m-b.m);
  const next=withMin.find(x=>x.m>=nm-(state.settings.pillbox.lateAfterMin||60));
  return next?next.sc:withMin[withMin.length-1].sc;
}
let PILL_BOX=null;
function pillboxForDate(date){
  const P=state.settings.pillbox;
  const wctx=pillWorkoutCtx(date);
  const today=pillToday(), isToday=date===today;
  const belowFloor=date<(P.floorDate||date);
  const dayIntakes=(state.medIntakes||[]).filter(i=>i.date===date);
  const byRef={}, freeIntakes=[];
  dayIntakes.forEach(i=>{ const ref=i.groupId||i.scheduleId; if(ref) byRef[ref]=i; else freeIntakes.push(i); });
  const cand=(state.medSchedules||[]).filter(sc=>{ const p=medById(sc.productId); return p&&!p.archived&&sc.active; });
  const slots=[],onDemand=[],notApplicable=[];

  cand.filter(sc=>!sc.groupId).forEach(sc=>{
    const p=medById(sc.productId);
    const isOnDemand=(sc.recurrence||{}).type==='asNeeded';
    const occurs=isOnDemand?false:pillOccursOn(sc,date);
    const intake=byRef[sc.id]||null;
    const conditional=(sc.anchor||{}).type==='workout';
    const eligible=conditional?wctx.any:true;
    if(isOnDemand){ onDemand.push(mkSlot(sc,p,date,wctx,intake,{onDemand:true,eligible:true,conditional:conditional})); return; }
    if(!occurs&&!intake) return;
    if(!occurs&&intake){ slots.push(mkSlot(sc,p,date,wctx,intake,{extra:true,eligible:true,conditional:conditional})); return; }
    if(belowFloor&&!intake) return;
    if(!eligible){
      if(intake) slots.push(mkSlot(sc,p,date,wctx,intake,{eligible:true,conditional:true,anyway:true}));
      else notApplicable.push(mkSlot(sc,p,date,wctx,null,{eligible:false,conditional:true}));
      return;
    }
    slots.push(mkSlot(sc,p,date,wctx,intake,{eligible:true,conditional:conditional}));
  });

  (state.medGroups||[]).forEach(g=>{
    if(!g.active) return;
    const p=medById(g.productId); if(!p||p.archived) return;
    const alts=cand.filter(sc=>sc.groupId===g.id).sort((a,b)=>(a.priority||0)-(b.priority||0));
    if(!alts.length) return;
    const intake=byRef[g.id]||null;
    const occurring=alts.filter(sc=>pillOccursOn(sc,date));
    const onDemandOnly=!occurring.length&&alts.every(sc=>(sc.recurrence||{}).type==='asNeeded');
    const usable=occurring.filter(sc=>(sc.anchor||{}).type!=='workout'||wctx.any);
    if(onDemandOnly){ onDemand.push(mkSlot(alts[0],p,date,wctx,intake,{onDemand:true,eligible:true,groupId:g.id,group:g,alts:alts})); return; }
    if(!occurring.length&&!intake) return;
    if(belowFloor&&!intake) return;
    if(!usable.length){
      if(intake){ const sc=alts.find(x=>x.id===intake.scheduleId)||occurring[0]||alts[0];
        slots.push(mkSlot(sc,p,date,wctx,intake,{eligible:true,groupId:g.id,group:g,alts:occurring,anyway:true})); }
      else notApplicable.push(mkSlot(occurring[0]||alts[0],p,date,wctx,null,{eligible:false,conditional:true,groupId:g.id,group:g,alts:occurring}));
      return;
    }
    let carrier;
    if(intake&&intake.scheduleId) carrier=alts.find(x=>x.id===intake.scheduleId)||usable[0];
    else carrier=pillCarrier(usable,date,wctx,isToday);
    slots.push(mkSlot(carrier,p,date,wctx,intake,{eligible:true,groupId:g.id,group:g,alts:usable}));
  });

  freeIntakes.forEach(i=>{
    const p=medById(i.productId); if(!p) return;
    slots.push({key:medKey(date,'free-'+i.id),kind:'free',date:date,productId:p.id,product:p,
      scheduleId:null,schedule:null,groupId:null,group:null,alts:[],
      estMin:i.at?hhmmToMin(i.at):ANY_MIN,timeLabel:i.at||'quand tu veux',whenLabel:'Prise libre',
      recLabel:'',conditional:false,eligible:true,onDemand:false,extra:true,anyway:false,
      status:i.status,intake:i,late:false,dose:i.qty||p.dose});
  });

  const nm=nowMin();
  slots.forEach(s=>{
    s.late=isToday&&s.status==='pending'&&(s.estMin===ANY_MIN?nm>=21*60:nm>s.estMin+(P.lateAfterMin||60));
    if(s.status==='snoozed'&&s.intake&&s.intake.snoozeUntil) s.snoozeMin=hhmmToMin(s.intake.snoozeUntil);
  });
  const rank=s=>(s.status==='taken'||s.status==='skipped')?1:0;
  const sorter=(a,b)=>rank(a)-rank(b)||a.estMin-b.estMin||(a.product.sortOrder||0)-(b.product.sortOrder||0)
    ||((a.product.name>b.product.name)?1:-1);
  slots.sort(sorter); onDemand.sort(sorter); notApplicable.sort(sorter);

  const counts={expected:0,taken:0,skipped:0,pending:0,late:0,extra:0};
  slots.forEach(s=>{
    if(s.extra){ counts.extra++; if(s.status==='taken') counts.taken++; return; }
    counts.expected++;
    if(s.status==='taken') counts.taken++;
    else if(s.status==='skipped') counts.skipped++;
    else { counts.pending++; if(s.late) counts.late++; }
  });
  if(P.countAsNeeded) onDemand.forEach(s=>{ counts.expected++; if(s.status==='taken') counts.taken++; });
  return {date:date,wctx:wctx,slots:slots,onDemand:onDemand,notApplicable:notApplicable,counts:counts};
}
function pillSlotByKey(key){
  const box=PILL_BOX||pillboxForDate(pillCtxDate());
  return box.slots.concat(box.onDemand,box.notApplicable).find(s=>s.key===key)||null;
}
function pillCtxDate(){
  /* Une date choisie hier ne doit pas coller au lendemain : on revient à aujourd'hui. */
  if(state.ui.pillDate&&state.ui.pillDateSetOn!==pillToday()) state.ui.pillDate=null;
  return state.ui.pillDate||pillToday();
}
function pillPendingCount(){
  if(!state.settings.modules.pillbox) return 0;
  const b=pillboxForDate(pillToday());
  return b.counts.pending;
}
function pillUpsertIntake(slot,fields){
  const date=slot.date||pillToday();
  const ref=slot.groupId||slot.scheduleId;
  state.medIntakes=state.medIntakes||[];
  let prev=ref?state.medIntakes.find(i=>i.date===date&&(i.groupId||i.scheduleId)===ref):null;
  const now=new Date().toISOString();
  const rec=prev||{id:uid(),createdAt:now};
  Object.assign(rec,{date:date,productId:slot.productId,
    scheduleId:(fields&&fields.scheduleId)||slot.scheduleId||null,groupId:slot.groupId||null,
    qty:(fields&&fields.qty!=null)?fields.qty:(slot.dose||''),note:(fields&&fields.note)||'',
    offPlan:!!(fields&&fields.offPlan)||!!slot.anyway||!slot.eligible,updatedAt:now},fields||{});
  if(!prev) state.medIntakes.push(rec);
  return rec;
}
function pillTake(slot,opts){
  opts=opts||{};
  const rec=pillUpsertIntake(slot,Object.assign({status:'taken',
    at:opts.at||(slot.date===pillToday()?nowHHMM():minToHHMM(slot.estMin===ANY_MIN?540:slot.estMin)),
    snoozeUntil:null},opts));
  haptic(12); update();
  toast(slot.product.name+' pris ✓',()=>pillUndo(rec.id));
  const b=pillboxForDate(slot.date);
  if(b.counts.expected>0&&b.counts.pending===0&&b.counts.skipped===0&&state.ui.pillCelebratedOn!==slot.date){
    state.ui.pillCelebratedOn=slot.date; saveNow();
    if(state.settings.celebrateOn!==false) confetti();
  }
  return rec;
}
function pillSkip(slot){
  const rec=pillUpsertIntake(slot,{status:'skipped',at:null,snoozeUntil:null});
  update(); toast('Noté — pas aujourd’hui',()=>pillUndo(rec.id));
}
function pillSnooze(slot,minutes){
  const rec=pillUpsertIntake(slot,{status:'snoozed',at:null,snoozeUntil:minToHHMM(nowMin()+minutes)});
  update(); toast('Reporté à '+rec.snoozeUntil,()=>pillUndo(rec.id));
}
function pillUndo(id){
  const i=(state.medIntakes||[]).findIndex(x=>x.id===id); if(i<0) return;
  state.medIntakes.splice(i,1); update();
}
/* Compte d'un jour. L'HEURE NE COMPTE PAS : un complément pris à midi au lieu de
   dix heures a été pris, point. Ce qui compte, c'est la journée. La journée en cours
   est marquée « partielle » : elle s'affiche, mais ne rentre dans aucune statistique. */
function pillDayCounts(date){
  if(date>pillToday()) return {expected:0,taken:0,skipped:0,pending:0,partial:false};   // le futur ne se juge pas
  const box=pillboxForDate(date);
  return {expected:box.counts.expected,taken:box.counts.taken,skipped:box.counts.skipped,
    pending:box.counts.pending,partial:date===pillToday()};
}
function pillAdherence(days,endYMD){
  const end=endYMD||pillToday(), floor=state.settings.pillbox.floorDate;
  let exp=0,tak=0,ski=0,daysCounted=0;
  for(let k=0;k<days;k++){
    const d=addDayYMD(end,-k);
    if(floor&&d<floor) break;
    const c=pillDayCounts(d);
    if(c.partial||!c.expected) continue;                 // la journée en cours n'est pas finie
    exp+=c.expected; tak+=Math.min(c.taken,c.expected); ski+=c.skipped; daysCounted++;
  }
  return {expected:exp,taken:tak,skipped:ski,days:daysCounted,pct:exp?Math.round(Math.min(100,tak/exp*100)):null};
}
/* La série ne se casse que sur un vrai oubli : une journée où rien n'a été pris alors
   que quelque chose était prévu. Un « pas aujourd'hui » assumé ne casse rien, et la
   journée en cours ne peut pas encore être un échec. */
function pillDayOk(c){ return c.expected===0||c.taken>=c.expected-c.skipped; }
function pillStreak(){
  const floor=state.settings.pillbox.floorDate;
  let d=pillToday(),n=0,guard=0;
  const ct=pillDayCounts(d);
  if(ct.expected>0&&ct.pending===0&&pillDayOk(ct)) n++;       // aujourd'hui ne compte que s'il est déjà bouclé
  d=addDayYMD(d,-1);
  while(guard++<400){
    if(floor&&d<floor) break;
    const c=pillDayCounts(d);
    if(c.expected===0){ d=addDayYMD(d,-1); continue; }
    if(!pillDayOk(c)) break;
    n++; d=addDayYMD(d,-1);
  }
  return n;
}
/* Les journées où il manque encore une case à cocher, dans les jours écoulés.
   Le plus souvent ce n'est pas un oubli de prise : c'est un oubli de pointage. */
function pillCatchUpDays(n){
  const out=[], floor=state.settings.pillbox.floorDate;
  for(let k=1;k<=(n||3);k++){
    const d=addDayYMD(pillToday(),-k);
    if(floor&&d<floor) break;
    const c=pillDayCounts(d);
    if(c.expected>0&&c.pending>0) out.push({date:d,pending:c.pending,expected:c.expected,taken:c.taken});
  }
  return out;
}
function pillSlotRow(slot,compact){
  const done=slot.status==='taken', skip=slot.status==='skipped', snz=slot.status==='snoozed';
  const cls='row pill-slot'+(done?' is-done':'')+(skip?' is-skipped':'')+(slot.late?' is-late':'');
  let sub;
  if(done) sub='Pris'+(slot.intake&&slot.intake.at?' à '+slot.intake.at:'')+' · '+slot.whenLabel.toLowerCase();
  else if(skip) sub='Pas aujourd’hui';
  else if(snz) sub='Reporté à '+(slot.intake?slot.intake.snoozeUntil:'');
  else if(slot.kind==='group') sub=pillGroupSubtitle(slot);
  else sub=slot.whenLabel+' · '+slot.timeLabel;
  let h='<div class="'+cls+'" data-act="pill-open" data-key="'+esc(slot.key)+'">'
    +'<div class="row-ic row-ic--emoji" style="background:color-mix(in srgb,'+(slot.product.color||'var(--acc)')+' 20%,var(--bg-3))">'+uem(slot.product.icon||'💊')+'</div>'
    +'<div class="row-main"><div class="row-title">'+esc(slot.product.name)
    +(slot.dose?' <span class="pill">'+esc(slot.dose)+'</span>':'')+'</div>'
    +'<div class="row-sub">'+sub

    +(slot.anyway?' <span class="badge badge--info">quand même</span>':'')
    +(slot.extra?' <span class="badge badge--info">en plus</span>':'')+'</div></div>';
  if(done||skip){
    h+='<button class="pill-check '+(done?'ok':'no')+'" data-act="pill-undo" data-id="'+(slot.intake?slot.intake.id:'')+'">'+ic(done?'check':'close','ic--sm')+'</button>';
  } else {
    h+='<div class="pill-actions">'
     +'<button class="pill-btn pill-btn--ok" data-act="pill-take" data-key="'+esc(slot.key)+'" aria-label="Pris">'+ic('check','ic--sm')+'</button>'
     +(compact?'':'<button class="pill-btn" data-act="pill-later" data-key="'+esc(slot.key)+'" aria-label="Plus tard">⏳</button>')
     +'<button class="pill-btn pill-btn--no" data-act="pill-skip" data-key="'+esc(slot.key)+'" aria-label="Pas aujourd’hui">'+ic('close','ic--sm')+'</button>'
     +'</div>';
  }
  return h+'</div>';
}
function pillGroupSubtitle(slot){
  const others=(slot.alts||[]).filter(x=>x.id!==slot.scheduleId);
  if(!others.length) return slot.whenLabel+' · '+slot.timeLabel;
  return slot.whenLabel+' · '+slot.timeLabel+' <span class="muted">ou '+esc(others.map(x=>pillWhenLabel(x).toLowerCase()).join(' ou '))+'</span>';
}

/* ---------- Écran : Pilulier ---------- */
function screenPillbox(){
  if(!state.settings.modules.pillbox){
    return backHead('Pilulier','/plus')
      +'<div class="card"><div class="row-title flex aic gap8">'+ic('pill','ic--sm')+'Pilulier</div>'
      +'<div class="small muted" style="margin:6px 0 12px">Médicaments, compléments, protéine… avec des prises fixes (matin, midi, soir) ou relatives : « 30 min après le déjeuner », « 15 min après la séance ». Rappel à l’ouverture de l’app.</div>'
      +'<button class="btn btn--primary btn--block" data-act="mod-on" data-k="pillbox">Activer le pilulier</button></div>';
  }
  const tab=state.ui.pillTab||'jour';
  const date=pillCtxDate();
  let h=backHead('Pilulier','/plus','<button class="btn-add" data-act="pill-new-product">+ Produit</button>');
  h+='<div class="subtabs">'+[['jour',"Aujourd'hui"],['semaine','Ma semaine'],['produits','Mes produits']].map(o=>
    '<button class="subtab'+(tab===o[0]?' is-active':'')+'" data-act="pill-tab" data-t="'+o[0]+'">'+esc(o[1])
    +(o[0]==='jour'&&pillPendingCount()>0?'<span class="pastille--num">'+pillPendingCount()+'</span>':'')+'</button>').join('')+'</div>';
  if(tab==='jour') h+=pillDayView(date);
  else if(tab==='produits') h+=pillProductsView();
  else h+=pillWeekView()+pillStatsView();
  return h;
}
function pillDayView(date){
  if(!(state.meds||[]).length)
    return empty('pill','Ton pilulier est vide','Ajoute tes médicaments, compléments ou ta protéine, puis dis-nous quand tu les prends.',
      '<button class="btn btn--primary" data-act="pill-new-product">+ Ajouter un produit</button>');
  const box=pillboxForDate(date); PILL_BOX=box;
  const isToday=date===pillToday();
  let h='';
  if(isToday){
    const cu=pillCatchUpDays(3);
    if(cu.length) h+='<div class="card" style="margin-bottom:12px"><div class="row-title">Rien de coché '
      +(cu.length===1?'le '+esc(fmtDateShort(cu[0].date)):'sur '+cu.length+' jours récents')+'</div>'
      +'<div class="small muted" style="margin:4px 0 10px">Le plus souvent, c’est le pointage qu’on oublie, pas la prise. Tu peux rattraper d’un geste.</div>'
      +'<div class="chip-wrap">'+cu.map(c=>'<button class="chip chip--act" data-act="pill-goto-day" data-date="'+c.date+'">'
        +esc(capit(fmtDayLabel(c.date)))+' · '+c.pending+' à cocher</button>').join('')+'</div></div>';
  }
  h+='<div class="flex aic" style="justify-content:center;gap:10px;margin:2px 0 12px">'
   +'<button class="chip" data-act="pill-day" data-d="-1">‹</button>'
   +'<b style="min-width:150px;text-align:center;text-transform:capitalize">'+esc(fmtDayLabel(date))+'</b>'
   +(isToday?'<span class="chip" style="opacity:.35">›</span>':'<button class="chip" data-act="pill-day" data-d="1">›</button>')
   +'</div>';
  const pct=box.counts.expected?box.counts.taken/box.counts.expected:0;
  h+='<div class="card"><div class="flex between aic"><div class="row-title">Pilulier du jour</div>'
   +'<div class="tnum muted">'+box.counts.taken+'/'+box.counts.expected+'</div></div>'
   +'<div class="bar" style="margin-top:10px"><span class="bar-seg" data-bar="'+pct.toFixed(3)+'" style="background:var(--grad-brand)"></span></div>'
   +(box.wctx.any?'<div class="small muted" style="margin-top:8px">'+esc(box.wctx.label||'Séance')
      +(box.wctx.startTime?' vers '+esc(box.wctx.startTime):'')+'</div>':'')
   +'</div>';
  if(box.counts.expected>0&&box.counts.pending===0&&box.counts.skipped===0){
    h+='<div class="card center" style="padding:22px;margin-top:12px"><div class="ob-mark" style="color:var(--acc-2)">'+ic('sparkle','ic--xl')+'</div>'
     +'<div style="font-weight:700;margin-top:6px">Pilulier complet</div>'
     +'<div class="small muted">'+box.counts.taken+' '+plural(box.counts.taken,'prise')+' sur '+box.counts.expected
     +(pillStreak()>1?' · série de '+pillStreak()+' jours':'')+'</div></div>';
  }
  let period=null;
  const main=box.slots.filter(s=>!s.extra);
  if(main.length){ h+='<div class="list" style="margin-top:12px">';
    main.forEach(s=>{ const p=pillPeriodOf(s.estMin);
      if(p!==period&&s.status==='pending'){ period=p; h+='<div class="day-head">'+esc(p)+'</div>'; }
      h+=pillSlotRow(s); });
    h+='</div>'; }
  else if(!box.notApplicable.length&&!box.onDemand.length)
    h+='<div class="card"><div class="small muted">Rien à prendre '+(isToday?'aujourd’hui':'ce jour-là')+'. Profite bien de ta journée.</div></div>';
  if(box.onDemand.length){
    h+='<div class="section-title">Au besoin</div><div class="list">'
     +box.onDemand.map(s=>'<div class="row pill-slot'+(s.status==='taken'?' is-done':'')+'">'
       +'<div class="row-ic row-ic--emoji">'+uem(s.product.icon||'💊')+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(s.product.name)+'</div>'
       +'<div class="row-sub">'+(s.status==='taken'?'Pris'+(s.intake&&s.intake.at?' à '+s.intake.at:''):esc(s.dose||'Au besoin'))+'</div></div>'
       +(s.status==='taken'
         ?'<button class="pill-check ok" data-act="pill-undo" data-id="'+s.intake.id+'">'+ic('check','ic--sm')+'</button>'
         :'<button class="chip chip--act" data-act="pill-take" data-key="'+esc(s.key)+'">+ J’en ai pris</button>')+'</div>').join('')
     +'</div>';
  }
  if(box.notApplicable.length){
    h+='<div class="section-title">Sans objet aujourd’hui</div><div class="card" style="padding:12px">'
     +'<div class="small muted" style="margin-bottom:8px">'+(state.settings.modules.sport
        ?'Pas de séance prévue aujourd’hui — ces prises ne te sont pas rappelées.'
        :'Le module Sport est désactivé : Élan ne sait pas quand tu t’entraînes, donc ces prises ne te sont pas rappelées.')+'</div>'
     +box.notApplicable.map(s=>'<div class="row pill-slot is-na">'
       +'<div class="row-ic row-ic--emoji">'+uem(s.product.icon||'💊')+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(s.product.name)+'</div>'
       +'<div class="row-sub">'+esc(s.whenLabel)+'</div></div>'
       +'<button class="btn btn--ghost" data-act="pill-anyway" data-key="'+esc(s.key)+'" style="padding:8px 10px;font-size:12.5px;flex:none">J’en ai pris quand même</button></div>').join('')
     +'</div>';
  }
  const extras=box.slots.filter(s=>s.extra);
  if(extras.length) h+='<div class="section-title">En plus</div><div class="list">'+extras.map(s=>pillSlotRow(s)).join('')+'</div>';
  h+='<button class="btn btn--ghost btn--block" data-act="pill-free" style="margin-top:12px">+ J’ai pris autre chose</button>';
  return h;
}
function pillWeekView(){
  if(!state.ui.pillWeek) state.ui.pillWeek=weekStartYMD(pillToday());
  const wk=state.ui.pillWeek;
  const days=[]; for(let k=0;k<7;k++) days.push(addDayYMD(wk,k));
  const boxes=days.map(pillboxForDate);
  const rows={};
  boxes.forEach((b,i)=>{ b.slots.concat(b.notApplicable).forEach(s=>{
    const ref=s.groupId||s.scheduleId||('free-'+s.productId);
    if(!rows[ref]) rows[ref]={ref:ref,product:s.product,cells:{}};
    rows[ref].cells[days[i]]=s; }); });
  const keys=Object.keys(rows);
  let h='<div class="flex aic" style="justify-content:center;gap:10px;margin:2px 0 12px">'
   +'<button class="chip" data-act="pill-week" data-d="-7">‹</button>'
   +'<b style="min-width:170px;text-align:center">semaine du '+esc(fmtDateShort(wk))+'</b>'
   +'<button class="chip" data-act="pill-week" data-d="7">›</button></div>';
  if(!keys.length) return h+'<div class="card"><div class="small muted">Aucune prise cette semaine-là.</div></div>';
  h+='<div class="card"><div class="pill-week"><div></div>'
   +['L','M','M','J','V','S','D'].map(d=>'<div class="cal-dow">'+d+'</div>').join('')+'</div>';
  keys.forEach(k=>{
    const r=rows[k];
    h+='<div class="pill-week" style="margin-top:4px"><div class="pill-week-name">'+uem(r.product.icon||'💊')+esc(r.product.name)+'</div>';
    days.forEach(d=>{
      const s=r.cells[d];
      let cls='pw-future', sym='○';
      if(d>pillToday()){ cls='pw-future'; sym='○'; }
      else if(!s){ cls='pw-na'; sym='–'; }
      else if(s.status==='taken'){ cls='pw-ok'; sym='✓'; }
      else if(s.status==='skipped'){ cls='pw-skip'; sym='✕'; }
      else if(!s.eligible){ cls='pw-na'; sym='–'; }
      else if(d===pillToday()){ cls='pw-future'; sym='○'; }   // la journée n'est pas finie : rien de « manqué »
      else { cls='pw-miss'; sym='·'; }
      h+='<div class="pw-cell '+cls+(d===pillToday()?' today':'')+'" data-act="pill-goto-day" data-date="'+d+'">'+sym+'</div>';
    });
    h+='</div>';
  });
  let exp=0,tak=0,enCours=0;
  days.forEach(d=>{ const c=pillDayCounts(d);
    if(c.partial){ enCours=c.expected-c.taken; return; }        // le jour en cours ne se juge pas
    exp+=c.expected; tak+=c.taken; });
  h+='<div class="small muted center" style="margin-top:10px">'
   +(exp?'Jours écoulés de la semaine · '+Math.round(tak/exp*100)+' % ('+tak+'/'+exp+')':'pas encore de prise attendue')
   +(enCours>0?' · '+enCours+' en attente aujourd’hui':'')+'</div>'
   +'<div class="hint" style="margin-top:8px">L’heure n’entre pas dans le calcul : une prise cochée le soir pour le matin compte pareil. Touche une case pour rattraper un jour.</div></div>';
  return h;
}
function pillProductsView(){
  const on=(state.meds||[]).filter(m=>m.active&&!m.archived);
  const off=(state.meds||[]).filter(m=>!m.active&&!m.archived);
  if(!on.length&&!off.length) return empty('pill','Aucun produit','Ajoute ton premier produit pour commencer.',
    '<button class="btn btn--primary" data-act="pill-new-product">+ Ajouter un produit</button>');
  const card=m=>{
    const scs=(state.medSchedules||[]).filter(s=>s.productId===m.id&&s.active);
    const st=pillProductStats(m.id,30);
    return '<div class="row" data-act="go" data-route="/produit/'+m.id+'">'
      +'<div class="row-ic row-ic--emoji" style="background:color-mix(in srgb,'+(m.color||'var(--acc)')+' 20%,var(--bg-3))">'+uem(m.icon||'💊')+'</div>'
      +'<div class="row-main"><div class="row-title">'+esc(m.name)+'</div>'
      +'<div class="row-sub">'+(m.dose?'<span class="pill">'+esc(m.dose)+'</span>':'')
      +'<span>'+esc(scs.map(s=>pillWhenLabel(s).toLowerCase()).join(' ou ')||'aucun créneau')+'</span></div></div>'
      +'<div class="row-amt small '+(st.pct!=null&&st.pct>=80?'down':'')+'">'+(st.pct!=null?st.pct+' %':'—')+'</div>'+arrowHTML()+'</div>';
  };
  let h='<div class="list" style="margin-top:12px">'+on.map(card).join('')+'</div>';
  if(off.length) h+='<div class="section-title">En pause</div><div class="list">'+off.map(card).join('')+'</div>';
  h+='<button class="btn btn--ghost btn--block" data-act="pill-new-product" style="margin-top:12px">+ Ajouter un produit</button>';
  return h;
}
function pillProductStats(productId,days){
  const end=pillToday(); let exp=0,tak=0; const times=[];
  for(let k=1;k<=days;k++){                       // on part d'hier : le jour en cours n'est pas fini
    const d=addDayYMD(end,-k);
    if(state.settings.pillbox.floorDate&&d<state.settings.pillbox.floorDate) break;
    const b=pillboxForDate(d);
    b.slots.filter(s=>s.productId===productId&&!s.extra).forEach(s=>{ exp++; if(s.status==='taken'){ tak++;
      if(s.intake&&s.intake.at) times.push(hhmmToMin(s.intake.at)); } });
  }
  return {expected:exp,taken:tak,pct:exp?Math.round(tak/exp*100):null,avgTimeMin:times.length?Math.round(meanOf(times)):null};
}
function pillStatsView(){
  const a7=pillAdherence(7), a30=pillAdherence(30), st=pillStreak();
  let h='<div class="section-title">Tes chiffres</div>'
   +'<div class="stats">'
   +statCard('7 jours',a7.pct!=null?a7.pct+' %':'—',a7.days?a7.days+' '+plural(a7.days,'jour')+' écoulé'+(a7.days>1?'s':''):'','')
   +statCard('30 jours',a30.pct!=null?a30.pct+' %':'—',a30.days?a30.days+' '+plural(a30.days,'jour'):'','')
   +statCard('Série',st+' j','sans oubli','')
   +'</div>'
   +'<div class="hint" style="margin:8px 4px 0">Seules les journées terminées comptent, et l’heure de la prise n’entre jamais dans le calcul.</div>';
  const prods=(state.meds||[]).filter(m=>!m.archived);
  if(!prods.length) return h;
  const rows=prods.map(m=>({m:m,st:pillProductStats(m.id,30)})).filter(r=>r.st.expected>0)
    .sort((a,b)=>(a.st.pct||0)-(b.st.pct||0));
  if(rows.length){
    /* Une seule phrase de commentaire, pour le produit le plus difficile à tenir.
       Répéter « difficile à tenir » sous chacune des onze lignes ne dit rien de plus
       et donne à l'écran un ton de bulletin scolaire. */
    const jours=rows.length?Math.max.apply(null,rows.map(r=>r.st.expected)):0;
    h+='<div class="section-title">Par produit</div><div class="card"><div class="chart-bars">'
     +rows.map(r=>'<div><div class="cbtop"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
       +uem(r.m.icon||'💊')+' '+esc(r.m.name)+'</span>'
       +'<span class="tnum muted nowrap">'+r.st.taken+'/'+r.st.expected+' · '+(r.st.pct!=null?r.st.pct+' %':'—')
       +(r.st.avgTimeMin!=null?' · '+minToHHMM(r.st.avgTimeMin):'')+'</span></div>'
       +'<div class="chart-bar-track"><div class="chart-bar-fill" data-bar="'+((r.st.pct||0)/100).toFixed(2)+'" style="background:'+(r.m.color||'var(--acc)')+'"></div></div></div>').join('')
     +'</div>';
    const pire=rows[0], best=rows[rows.length-1];
    let mot;
    if(best.st.pct>=90&&pire.st.pct>=70) mot='Tout tient bien. '+esc(best.m.name)+' est ton plus régulier.';
    else if(pire.st.pct<50) mot='C’est '+esc(pire.m.name)+' qui passe le plus souvent à la trappe'
      +(pire.st.avgTimeMin!=null?' — tu le prends en général vers '+minToHHMM(pire.st.avgTimeMin)+', peut-être que le créneau prévu ne correspond pas à ta vraie journée.':'.');
    else mot='Rien d’alarmant : '+esc(pire.m.name)+' est le moins régulier, le reste suit.';
    h+='<div class="small muted" style="margin-top:12px;line-height:1.5">'+mot
     +(jours?' Calculé sur '+jours+' '+plural(jours,'journée')+' terminée'+(jours>1?'s':'')+'.':'')+'</div>'
     +'<div class="hint" style="margin-top:8px">Un créneau peut se déplacer : touche le produit, puis son horaire.</div></div>';
  }
  (state.medGroups||[]).forEach(g=>{
    const split=pillGroupSplit(g.id,60);
    if(!split.total) return;
    h+='<div class="section-title">'+esc(g.name||'Alternatives')+'</div><div class="chart-bars">'
     +split.rows.map(r=>'<div><div class="cbtop"><span>'+esc(r.label)+'</span><span class="tnum muted">'+r.n+' fois ('+r.pct+' %)</span></div>'
       +'<div class="chart-bar-track"><div class="chart-bar-fill" data-bar="'+(r.pct/100).toFixed(2)+'" style="background:var(--acc)"></div></div></div>').join('')
     +'</div>';
  });
  h+='<button class="btn btn--ghost btn--block" data-act="pill-ics-all" style="margin-top:14px">'+ic('calendar')+'Exporter mes créneaux vers le calendrier</button>'
   +'<div class="hint" style="margin-top:8px">iPhone n’autorise pas une application web à envoyer des notifications programmées. Élan te rappelle tes prises à chaque ouverture. Pour une vraie alarme, exporte tes créneaux vers ton Calendrier — l’alerte viendra alors d’iOS.</div>';
  return h;
}
function pillGroupSplit(groupId,days){
  const from=addDayYMD(pillToday(),-(days-1));
  const scs=(state.medSchedules||[]).filter(s=>s.groupId===groupId);
  const counts={}; let total=0;
  (state.medIntakes||[]).forEach(i=>{ if(i.groupId===groupId&&i.status==='taken'&&i.date>=from){
    counts[i.scheduleId]=(counts[i.scheduleId]||0)+1; total++; } });
  return {total:total,rows:scs.map(s=>({label:pillWhenLabel(s),n:counts[s.id]||0,
    pct:total?Math.round((counts[s.id]||0)/total*100):0})).sort((a,b)=>b.n-a.n)};
}
function screenMedDetail(id){
  if(!state.settings.modules.pillbox)
    return backHead('Produit','/plus')
      +'<div class="card"><div class="row-title flex aic gap8">'+ic('pill','ic--sm')+'Pilulier désactivé</div>'
      +'<div class="small muted" style="margin:6px 0 12px">Active le pilulier pour revoir ce produit. Rien n’a été supprimé.</div>'
      +'<button class="btn btn--primary btn--block" data-act="mod-on" data-k="pillbox">Activer le pilulier</button></div>';
  const m=medById(id);
  if(!m) return backHead('Produit','/pilulier')+empty('pill','Produit introuvable','Il a peut-être été supprimé.',
    '<button class="btn btn--primary" data-act="go" data-route="/pilulier">Revenir au pilulier</button>');
  const scs=(state.medSchedules||[]).filter(s=>s.productId===id);
  const groups=(state.medGroups||[]).filter(g=>g.productId===id);
  const st=pillProductStats(id,30);
  let h=backHead(m.name,'/pilulier','<button class="btn-add" data-act="pill-edit-product" data-id="'+id+'">Modifier</button>');
  h+='<div class="card"><div class="today-top"><div class="today-ic today-ic--emoji" style="background:color-mix(in srgb,'+(m.color||'var(--acc)')+' 20%,var(--bg-3))">'+uem(m.icon||'💊')+'</div>'
   +'<div class="row-main"><div class="row-title">'+esc(m.name)+'</div>'
   +'<div class="small muted">'+esc(medKindLabel(m.kind))+(m.dose?' · '+esc(m.dose):'')+'</div>'
   +'<div class="small muted">'+(m.endDate?('Du '+fmtDateShort(m.startDate)+' au '+fmtDateShort(m.endDate)):('Depuis le '+fmtDateShort(m.startDate)))+'</div></div></div>'
   +(m.note?'<div class="small muted" style="margin-top:8px">'+esc(m.note)+'</div>':'')+'</div>';
  h+='<div class="section-title">Quand</div>';
  groups.forEach(g=>{
    const alts=scs.filter(s=>s.groupId===g.id).sort((a,b)=>(a.priority||0)-(b.priority||0));
    if(!alts.length) return;
    h+='<div class="card"><div class="row-title">'+esc(g.name||'Une prise parmi')+'</div>'
     +'<div class="small muted" style="margin:4px 0 10px">Une seule prise attendue par jour : coche l’une des alternatives et la journée est validée.</div>'
     +alts.map((s,i)=>'<div class="pill-alt" data-act="pill-edit-sched" data-id="'+s.id+'">'+esc(pillWhenLabel(s))
       +' <span class="muted small">· '+esc(pillRecLabel(s))+'</span>'
       +(i===0?'<span class="pill">préféré</span>':'')+'</div>'
       +(i<alts.length-1?'<div class="pill-or">ou</div>':'')).join('')
     +'<button class="btn-add" data-act="pill-group-edit" data-id="'+g.id+'" style="margin-top:8px">Modifier le groupe</button></div>';
  });
  const solo=scs.filter(s=>!s.groupId);
  if(solo.length) h+='<div class="list">'+solo.map(s=>'<div class="row" data-act="pill-edit-sched" data-id="'+s.id+'">'
    +'<div class="row-ic">'+ic('clock')+'</div><div class="row-main"><div class="row-title">'+esc(pillWhenLabel(s))+'</div>'
    +'<div class="row-sub">'+esc(pillRecLabel(s))+(s.active?'':' <span class="badge badge--miss">inactif</span>')+'</div></div>'+arrowHTML()+'</div>').join('')+'</div>';
  if(!scs.length) h+='<div class="card"><div class="small muted">Aucun créneau. Dis-nous quand tu prends ce produit.</div></div>';
  h+='<button class="btn btn--ghost btn--block" data-act="pill-new-sched" data-pid="'+id+'" style="margin-top:10px">+ Ajouter un créneau</button>';
  if(solo.length>=2) h+='<button class="btn btn--ghost btn--block" data-act="pill-group-new" data-pid="'+id+'" style="margin-top:8px">'+ic('shuffle')+'Créer un groupe d’alternatives</button>';
  h+='<div class="section-title">Statistiques</div><div class="stats stats-2">'
   +statCard('Observance 30 j',st.pct!=null?st.pct+' %':'—',st.taken+'/'+st.expected,'')
   +statCard('Heure moyenne',st.avgTimeMin!=null?minToHHMM(st.avgTimeMin):'—','','')
   +'</div>';
  const hist=(state.medIntakes||[]).filter(i=>i.productId===id).sort((a,b)=>a.date<b.date?1:-1).slice(0,30);
  if(hist.length){
    h+='<div class="section-title">Historique</div><div class="list">'
     +hist.map(i=>'<div class="row"><div class="row-ic" style="color:'+(i.status==='taken'?'var(--pos)':'var(--tx-3)')+'">'
     +ic(i.status==='taken'?'check':(i.status==='skipped'?'close':'hourglass'))+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(capit(fmtDayLabel(i.date)))+'</div>'
       +'<div class="row-sub">'+(i.at?i.at+' · ':'')+esc(i.qty||'')+(i.offPlan?' <span class="badge badge--info">hors plan</span>':'')+'</div></div>'
       +'<button class="btn-add" data-act="pill-undo" data-id="'+i.id+'">Annuler</button></div>').join('')
     +'</div>';
  }
  h+='<div class="spacer"></div>'
   +'<button class="btn btn--ghost btn--block" data-act="pill-pause-product" data-id="'+id+'">'+(m.active?'Mettre en pause':'Reprendre')+'</button>'
   +'<button class="btn btn--danger btn--block" data-act="pill-del-product" data-id="'+id+'" style="margin-top:8px">Supprimer</button>';
  return h;
}

/* ---------- Éditeurs du pilulier ---------- */
let PILL_FORM=null, PILL_SF=null, PILL_TAKE=null;
function pillProductEditor(id){
  const m=id?medById(id):null;
  PILL_FORM=m?Object.assign({},m):{id:null,name:'',icon:'🧪',kind:'complement',dose:'',note:'',
    color:medKindColor('complement'),active:true,archived:false,startDate:isoToday(),endDate:null,sortOrder:(state.meds||[]).length};
  openSheet(m?'Modifier le produit':'Nouveau produit',pillProductBody());
}
function pillProductBody(){
  const F=PILL_FORM;
  return '<div class="row-2"><div class="field"><label>Émoji</label><input class="input" id="mIcon" maxlength="4" value="'+esc(F.icon)+'"></div>'
   +'<div class="field"><label>Nom</label><input class="input" id="mName" value="'+esc(F.name)+'" placeholder="Ex. : Whey protéine"></div></div>'
   +'<div class="field"><label>Type</label>'+segHTML(MED_KINDS.map(k=>[k[0],k[1]]),F.kind,'pill-kind','seg--sm')+'</div>'
   +'<div class="field"><label>Quantité</label><input class="input" id="mDose" value="'+esc(F.dose||'')+'" placeholder="Ex. : 1 dosette, 2 gélules, 30 g"></div>'
   +'<div class="field"><label>Note</label><textarea class="input" id="mNote" placeholder="Ex. : à prendre avec un grand verre d’eau">'+esc(F.note||'')+'</textarea></div>'
   +'<div class="row-2"><div class="field"><label>Début</label><input class="input" type="date" id="mStart" value="'+(F.startDate||isoToday())+'"></div>'
   +'<div class="field"><label>Fin (facultatif)</label><input class="input" type="date" id="mEnd" value="'+(F.endDate||'')+'"></div></div>'
   +'<div class="hint">Laisse la fin vide si tu le prends sans limite. Pour une cure, mets la date de fin.</div>'
   +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="pill-save-product" data-id="'+(F.id||'')+'">Enregistrer</button></div>';
}
function savePillProduct(id){
  const g=x=>{ const el=document.getElementById(x); return el?el.value:''; };
  const name=(g('mName')||'').trim();
  if(!name){ toast('Donne un nom au produit'); return; }
  const start=g('mStart')||isoToday(), end=g('mEnd')||null;
  if(end&&end<start){ toast('La date de fin doit être après le début'); return; }
  const now=new Date().toISOString();
  const data={name:name,icon:(g('mIcon')||medKindIcon(PILL_FORM.kind)).slice(0,4),kind:PILL_FORM.kind,
    dose:(g('mDose')||'').trim(),note:(g('mNote')||'').trim(),color:medKindColor(PILL_FORM.kind),
    startDate:start,endDate:end,updatedAt:now};
  let pid=id;
  if(id){ Object.assign(medById(id),data); }
  else{ const m=Object.assign({id:uid(),active:true,archived:false,sortOrder:(state.meds||[]).length,createdAt:now},data);
    state.meds.push(m); pid=m.id; }
  if(!state.settings.modules.pillbox){ state.settings.modules.pillbox=true; state.settings.pillbox.floorDate=isoToday(); }
  closeSheet(); update(); toast('Produit enregistré ✓');
  if(!(state.medSchedules||[]).some(s=>s.productId===pid)) setTimeout(()=>pillScheduleEditor(pid,null),200);
}
function deletePillProduct(id){
  const m=medById(id); if(!m) return;
  confirmSheet('Supprimer ce produit','Le produit, ses créneaux et tout son historique de prises seront supprimés. Continuer ?',()=>{
    const snap={meds:state.meds.slice(),medSchedules:state.medSchedules.slice(),
      medGroups:state.medGroups.slice(),medIntakes:state.medIntakes.slice()};
    state.meds=state.meds.filter(x=>x.id!==id);
    state.medSchedules=state.medSchedules.filter(x=>x.productId!==id);
    state.medGroups=state.medGroups.filter(x=>x.productId!==id);
    state.medIntakes=state.medIntakes.filter(x=>x.productId!==id);
    closeSheet(); nav('/pilulier'); update();
    toast('Produit supprimé',()=>{ Object.assign(state,snap); update(); });
  },true,'Supprimer');
}
function pillScheduleEditor(productId,id){
  const sc=id?schedById(id):null;
  const pid=productId||(sc&&sc.productId);
  PILL_SF=sc?JSON.parse(JSON.stringify(sc)):{id:null,productId:pid,groupId:null,priority:0,label:'',qty:'',
    anchor:{type:'moment',moment:'matin',time:'08:00',meal:'dejeuner',dir:'after',offsetMin:30},
    recurrence:{type:'daily',days:[1,2,3,4,5],n:2,anchorDate:isoToday()},
    startDate:isoToday(),endDate:null,active:true};
  openSheet(sc?'Modifier le créneau':'Quand le prends-tu ?',pillSchedBody());
}
function pillSchedBody(){
  const F=PILL_SF, a=F.anchor, r=F.recurrence;
  const p=medById(F.productId);
  let h='<div class="field"><label>Quand ?</label>'
   +segHTML([['moment','Moment'],['time','Heure'],['meal','Repas'],['workout','Séance']],a.type,'pill-anchor','seg--sm')+'</div>';
  if(a.type==='moment'){
    h+='<div class="chip-wrap">'+MOMENT_ORDER.map(m=>
      '<button class="chip chip--act'+(a.moment===m?' is-active':'')+'" data-act="pill-moment" data-m="'+m+'">'+esc(MOMENT_LABEL[m])+'</button>').join('')+'</div>';
  } else if(a.type==='time'){
    h+='<div class="field"><label>Heure</label><input class="input" type="time" id="sTime" value="'+(a.time||'08:00')+'"></div>';
  } else {
    h+='<div class="field">'+segHTML([['before','Avant'],['after','Après']],a.dir,'pill-dir','seg--sm')+'</div>'
     +'<div class="row-2"><div class="field"><label>Combien de minutes</label><input class="input tnum" id="sOff" inputmode="numeric" value="'+(a.offsetMin||0)+'"></div>'
     +(a.type==='meal'?'<div class="field"><label>Repas</label><select class="input" id="sMeal">'
        +Object.keys(MEAL_LABEL).map(k=>'<option value="'+k+'"'+(a.meal===k?' selected':'')+'>'+esc(capit(MEAL_LABEL[k]))+'</option>').join('')
        +'</select></div>':'<div class="field"><label>Repère</label><input class="input" value="la séance" disabled></div>')
     +'</div>';
    const preview=pillEstMin(F,isoToday(),pillWorkoutCtx(isoToday()));
    h+='<div class="hint" id="sPreview">Exemple : '+esc(pillWhenLabel(F))+' → '+esc(pillTimeLabel(preview,F,pillWorkoutCtx(isoToday())))+'</div>';
    if(a.type==='workout'){
      h+='<div class="hint" style="margin-top:8px">Ce créneau ne s’affichera que les jours où tu as une séance (prévue ou déjà enregistrée). Les autres jours, tu pourras quand même le cocher depuis « Sans objet aujourd’hui ».</div>';
      if(!state.settings.modules.sport) h+='<div class="hint">Active le module Sport pour que ce créneau se déclenche automatiquement les jours de séance.</div>';
    }
  }
  h+='<div class="field" style="margin-top:16px"><label>Quels jours ?</label>'
   +segHTML([['daily','Tous les jours'],['weekdays','Certains jours'],['everyNDays','1 jour sur N'],['asNeeded','Au besoin']],r.type,'pill-rec','seg--sm')+'</div>';
  if(r.type==='weekdays'){
    const names=['L','M','M','J','V','S','D'], order=[1,2,3,4,5,6,0];
    h+='<div class="chip-wrap">'+order.map((d,i)=>
      '<button class="chip'+((r.days||[]).indexOf(d)>=0?' is-active':'')+'" data-act="pill-dow" data-n="'+d+'" style="min-width:44px">'+names[i]+'</button>').join('')+'</div>';
  } else if(r.type==='everyNDays'){
    h+='<div class="row-2"><div class="field"><label>Un jour sur</label><input class="input tnum" id="sN" inputmode="numeric" value="'+(r.n||2)+'"></div>'
     +'<div class="field"><label>À partir du</label><input class="input" type="date" id="sAnchor" value="'+(r.anchorDate||isoToday())+'"></div></div>';
  } else if(r.type==='asNeeded'){
    h+='<div class="hint">Ce produit n’apparaîtra pas dans les rappels. Tu pourras le cocher quand tu le prends, depuis la section « Au besoin ».</div>';
  }
  h+='<div class="field" style="margin-top:16px"><label>Quantité pour ce créneau</label><input class="input" id="sQty" value="'+esc(F.qty||'')+'" placeholder="'+esc(p&&p.dose?p.dose:'comme le produit')+'"></div>'
   +'<div class="field"><label>Libellé personnalisé</label><input class="input" id="sLabel" value="'+esc(F.label||'')+'" placeholder="'+esc(pillWhenLabel(Object.assign({},F,{label:''})))+'"></div>';
  const others=(state.medSchedules||[]).filter(s=>s.productId===F.productId&&s.id!==F.id);
  if(others.length){
    const gs=(state.medGroups||[]).filter(g=>g.productId===F.productId);
    h+='<div class="field"><label>Alternatives</label><select class="input" id="sGroup">'
     +'<option value="">— Créneau indépendant —</option>'
     +gs.map(g=>'<option value="'+g.id+'"'+(F.groupId===g.id?' selected':'')+'>'+esc(g.name||'Groupe')+'</option>').join('')
     +'<option value="__new"'+(F.groupId==='__new'?' selected':'')+'>+ Nouveau groupe d’alternatives…</option>'
     +'</select>'
     +'<div class="hint">Dans un groupe, une seule prise est attendue par jour : coche l’une des alternatives et la journée est validée. Exemple : ta protéine se prend soit au goûter, soit après la séance.</div></div>';
  }
  h+='<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="pill-save-sched" data-pid="'+F.productId+'" data-id="'+(F.id||'')+'">Enregistrer</button>'
   +(F.id?'<button class="btn btn--danger btn--block" data-act="pill-del-sched" data-id="'+F.id+'" style="margin-top:8px">Supprimer ce créneau</button>':'')
   +'</div>';
  return h;
}
function savePillSchedule(pid,id){
  const g=x=>{ const el=document.getElementById(x); return el?el.value:null; };
  const F=PILL_SF;
  if(F.anchor.type==='time') F.anchor.time=g('sTime')||'08:00';
  if(F.anchor.type==='meal'||F.anchor.type==='workout'){
    F.anchor.offsetMin=clamp(parseInt(g('sOff'),10)||0,0,240);
    if(F.anchor.type==='meal'&&g('sMeal')) F.anchor.meal=g('sMeal');
  }
  if(F.recurrence.type==='weekdays'&&!(F.recurrence.days||[]).length){ toast('Choisis au moins un jour'); return; }
  if(F.recurrence.type==='everyNDays'){
    F.recurrence.n=clamp(parseInt(g('sN'),10)||2,2,30);
    F.recurrence.anchorDate=g('sAnchor')||isoToday();
  }
  F.qty=(g('sQty')||'').trim();
  F.label=(g('sLabel')||'').trim();
  /* Si le sélecteur de groupe n'a pas été rendu, on ne touche PAS à l'appartenance
     existante : l'absence de champ ne vaut pas « retirer du groupe ». */
  const grpEl=document.getElementById('sGroup');
  let grp=grpEl?grpEl.value:(F.groupId||'');
  const now=new Date().toISOString();
  if(grp==='__new'){
    const p=medById(pid);
    const ng={id:uid(),productId:pid,name:p?p.name:'Alternatives',targetPerDay:1,active:true,createdAt:now,updatedAt:now};
    state.medGroups.push(ng); grp=ng.id;
    /* Le créneau existant du produit rejoint automatiquement le groupe : sinon l'utilisateur
       se retrouverait avec deux lignes alors qu'il vient de dire « c'est l'un OU l'autre ». */
    (state.medSchedules||[]).forEach(s=>{ if(s.productId===pid&&!s.groupId&&s.id!==id){ s.groupId=grp; s.priority=0; } });
  }
  F.groupId=grp||null;
  if(id){ Object.assign(schedById(id),F,{updatedAt:now}); }
  else{ state.medSchedules.push(Object.assign({},F,{id:uid(),createdAt:now,updatedAt:now})); }
  closeSheet(); update();
  toast(F.anchor.type==='workout'&&!state.settings.modules.sport?'Créneau enregistré — pense à activer le module Sport':'Créneau enregistré ✓');
  PILL_SF=null;
}
function deletePillSchedule(id){
  confirmSheet('Supprimer ce créneau','Les prises déjà enregistrées sont conservées.',()=>{
    const i=(state.medSchedules||[]).findIndex(s=>s.id===id); if(i<0) return;
    const s=state.medSchedules[i]; state.medSchedules.splice(i,1);
    closeSheet(); update();
    toast('Créneau supprimé',()=>{ state.medSchedules.splice(i,0,s); update(); });
  },true,'Supprimer');
}
function pillGroupEditor(pid,gid){
  const g=gid?groupById(gid):null;
  const productId=pid||(g&&g.productId);
  const p=medById(productId);
  const scs=(state.medSchedules||[]).filter(s=>s.productId===productId);
  openSheet('Une prise parmi…',
    '<div class="field"><label>Nom du groupe</label><input class="input" id="gName" value="'+esc(g?g.name:(p?p.name:''))+'"></div>'
    +'<div class="hint">Exemple : ta protéine se prend soit au goûter, soit après la séance. Une seule des deux compte pour la journée.</div>'
    +'<div class="section-title">Créneaux du groupe</div>'
    +scs.map(s=>toggleHTML(pillWhenLabel(s),g?s.groupId===g.id:true,'pill-alt-toggle',' data-id="'+s.id+'"',pillRecLabel(s))).join('')
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="pill-group-save" data-pid="'+productId+'" data-id="'+(gid||'')+'">Enregistrer</button>'
    +(gid?'<button class="btn btn--ghost btn--block" data-act="pill-group-del" data-id="'+gid+'" style="margin-top:8px">Séparer les créneaux</button>':'')
    +'</div>');
}
function savePillGroup(pid,gid){
  const name=(document.getElementById('gName')||{}).value||'';
  const on=qa('#sheet-root .switch.on[data-act="pill-alt-toggle"]').map(el=>el.dataset.id);
  const now=new Date().toISOString();
  let g;
  if(gid){ g=groupById(gid); g.name=name.trim()||g.name; g.updatedAt=now; }
  else{ g={id:uid(),productId:pid,name:name.trim()||'Alternatives',targetPerDay:1,active:true,createdAt:now,updatedAt:now};
    state.medGroups.push(g); }
  (state.medSchedules||[]).forEach(s=>{
    if(s.productId!==pid) return;
    if(on.indexOf(s.id)>=0){ s.groupId=g.id; } else if(s.groupId===g.id){ s.groupId=null; }
  });
  const alts=(state.medSchedules||[]).filter(s=>s.groupId===g.id);
  alts.forEach((s,i)=>{ s.priority=i; });
  closeSheet(); update(); toast('Groupe enregistré ✓');
}
function deletePillGroup(gid){
  const g=groupById(gid); if(!g) return;
  confirmSheet('Séparer les créneaux',
    'Les créneaux de ce groupe redeviendront indépendants : Élan attendra alors une prise pour CHACUN, au lieu d’une seule parmi eux. L’historique est conservé.',()=>{
    const touched=(state.medSchedules||[]).filter(s=>s.groupId===gid).map(s=>s.id);
    touched.forEach(id=>{ const sc=schedById(id); if(sc) sc.groupId=null; });
    state.medGroups=state.medGroups.filter(x=>x.id!==gid);
    closeSheet(); update();
    toast('Créneaux séparés',()=>{ state.medGroups.push(g); touched.forEach(id=>{ const sc=schedById(id); if(sc) sc.groupId=gid; }); update(); });
  },false,'Séparer');
}
function pillTakeSheet(slot){
  PILL_TAKE={key:slot.key,scheduleId:slot.scheduleId};
  const alts=slot.alts||[];
  let h='<div class="small muted" style="margin-bottom:10px">Prévu '+esc(slot.whenLabel.toLowerCase())+' · '+esc(slot.timeLabel)+'</div>';
  if(slot.kind==='group'&&alts.length>1){
    h+='<div class="field"><label>Créneau utilisé</label>'
     +'<div class="seg seg--sm">'+alts.map(a=>'<button class="seg-opt'+(a.id===slot.scheduleId?' is-active':'')+'" data-act="pill-alt-choose" data-id="'+a.id+'">'+esc(pillWhenLabel(a))+'</button>').join('')+'</div></div>';
  }
  h+='<div class="row-2"><div class="field"><label>Heure</label><input class="input" type="time" id="tkAt" value="'+(slot.date===pillToday()?nowHHMM():minToHHMM(slot.estMin===ANY_MIN?540:slot.estMin))+'"></div>'
   +'<div class="field"><label>Quantité</label><input class="input" id="tkQty" value="'+esc(slot.dose||'')+'"></div></div>'
   +'<div class="field"><label>Note</label><textarea class="input" id="tkNote" placeholder="Facultatif"></textarea></div>'
   +'<div class="sheet-foot">'
   +'<button class="btn btn--primary btn--block" data-act="pill-confirm-take">'+ic('check')+'J’ai pris</button>'
   +'<div class="btn-row" style="margin-top:8px">'
   +'<button class="btn btn--ghost" data-act="pill-later-menu">⏳ Plus tard</button>'
   +'<button class="btn btn--ghost" data-act="pill-skip" data-key="'+esc(slot.key)+'">'+ic('close')+'Pas ce jour</button></div>'
   +(slot.scheduleId?'<button class="btn-add" data-act="pill-edit-sched" data-id="'+slot.scheduleId+'" style="margin-top:8px">Modifier ce créneau ›</button>':'')
   +'</div>';
  openSheet(slot.product.name,h);
}
function pillLaterBody(){
  return '<div class="chip-wrap">'+[[30,'+30 min'],[60,'+1 h'],[120,'+2 h']].map(o=>
    '<button class="chip chip--act" data-act="pill-snooze" data-m="'+o[0]+'">'+esc(o[1])+'</button>').join('')
    +'<button class="chip chip--act" data-act="pill-snooze" data-m="'+Math.max(30,hhmmToMin(state.settings.pillbox.momentTimes.soir)-nowMin())+'">Ce soir</button></div>';
}
function pillConfirmTakeFromSheet(){
  const s=pillSlotByKey(PILL_TAKE.key); if(!s) return;
  const g=x=>{ const el=document.getElementById(x); return el?el.value:''; };
  closeSheet();
  pillTake(s,{at:g('tkAt')||nowHHMM(),qty:g('tkQty')||s.dose,note:g('tkNote')||'',scheduleId:PILL_TAKE.scheduleId||s.scheduleId});
}
function pillFreeIntakeSheet(){
  const prods=(state.meds||[]).filter(m=>!m.archived);
  if(!prods.length){ toast('Ajoute d’abord un produit'); return; }
  openSheet('J’ai pris autre chose',
    '<div class="field"><label>Produit</label><select class="input" id="fiProd">'
    +prods.map(m=>'<option value="'+m.id+'">'+(m.icon||'💊')+' '+esc(m.name)+'</option>').join('')+'</select></div>'
    +'<div class="row-2"><div class="field"><label>Heure</label><input class="input" type="time" id="fiAt" value="'+nowHHMM()+'"></div>'
    +'<div class="field"><label>Quantité</label><input class="input" id="fiQty"></div></div>'
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="pill-save-free">Enregistrer</button></div>');
}
function pillSaveFreeIntake(){
  const g=x=>{ const el=document.getElementById(x); return el?el.value:''; };
  const pid=g('fiProd'); const p=medById(pid); if(!p) return;
  const now=new Date().toISOString();
  state.medIntakes.push({id:uid(),date:pillCtxDate(),productId:pid,scheduleId:null,groupId:null,
    status:'taken',at:g('fiAt')||nowHHMM(),qty:g('fiQty')||p.dose||'',note:'',offPlan:true,snoozeUntil:null,
    createdAt:now,updatedAt:now});
  closeSheet(); update(); toast(p.name+' noté ✓');
}
/* Export .ics : la seule vraie alarme possible sur iPhone passe par le calendrier d'iOS. */
function pillIcsFor(sc){
  const p=medById(sc.productId), P=state.settings.pillbox;
  const stamp=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const esc2=s=>String(s||'').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');
  const start=(sc.startDate&&sc.startDate>isoToday())?sc.startDate:isoToday();
  const est=pillEstMin(sc,start,pillWorkoutCtx(start));
  const hhmm=est===ANY_MIN?'09:00':minToHHMM(est);
  const dt=start.replace(/-/g,'')+'T'+hhmm.replace(':','')+'00';
  const r=sc.recurrence||{type:'daily'}; let rule='';
  if(r.type==='daily') rule='RRULE:FREQ=DAILY';
  if(r.type==='everyNDays') rule='RRULE:FREQ=DAILY;INTERVAL='+Math.max(2,r.n||2);
  if(r.type==='weekdays'){ const map=['SU','MO','TU','WE','TH','FR','SA'];
    rule='RRULE:FREQ=WEEKLY;BYDAY='+(r.days||[]).map(d=>map[d]).join(','); }
  if(rule&&sc.endDate) rule+=';UNTIL='+sc.endDate.replace(/-/g,'')+'T235959Z';
  const sum='Élan : '+esc2(p.name)+(p.dose?' ('+esc2(p.dose)+')':'');
  const desc=esc2(pillWhenLabel(sc)+' · '+pillRecLabel(sc)
    +(sc.anchor.type==='workout'?' — heure estimée, uniquement les jours de séance':'')+' — via Élan');
  const lines=['BEGIN:VEVENT','UID:'+sc.id+'@elan','DTSTAMP:'+stamp,'DTSTART:'+dt,'DURATION:PT10M',
    'SUMMARY:'+sum,'DESCRIPTION:'+desc];
  if(rule) lines.push(rule);
  lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+esc2(p.name),'TRIGGER:-PT0M','END:VALARM','END:VEVENT');
  return lines.join('\r\n');
}
function pillDownloadIcsAll(){
  const scs=(state.medSchedules||[]).filter(s=>s.active&&(s.recurrence||{}).type!=='asNeeded');
  if(!scs.length){ toast('Aucun créneau à exporter'); return; }
  const txt=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Elan//FR//','CALSCALE:GREGORIAN']
    .concat(scs.map(pillIcsFor)).concat(['END:VCALENDAR']).join('\r\n');
  const blob=new Blob([txt],{type:'text/calendar'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='pilulier-elan.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Fichier .ics créé — ouvre-le pour l’ajouter au calendrier');
}
/* Prises en retard du jour (sert au rappel d'ouverture). */
function pillLateToday(){
  if(!state.settings.modules.pillbox) return [];
  const box=pillboxForDate(pillToday()), nm=nowMin(), gr=state.settings.pillbox.lateAfterMin||60;
  return box.slots.filter(s=>!s.extra&&s.status==='pending'&&s.estMin!==ANY_MIN&&nm>s.estMin+gr);
}

/* ---------- Écran : Plus ---------- */
function screenPlus(){
  const m=state.settings.modules;
  /* Quatre familles, dans l'ordre où on s'en sert : comprendre, agir, garder, régler.
     Les couleurs viennent des mesures qu'elles servent — jamais posées au hasard. */
  const items=[
    ['/objectif','target','Mon objectif','poids cible, date estimée','var(--m-goal)'],
    ['/semaine','calendar','Ma semaine','le bilan des sept derniers jours','var(--acc)'],
    ['/analyse','microscope','Analyse','comprendre mon corps','var(--m-eau)'],
    ['/simulateur','calculator','Simulateur','où j’en serai, et quand','var(--m-imc)'],
    ['/astuces','toolbox','Boîte à outils','repères et astuces','var(--m-cal)'],
    ['/mensurations','ruler','Mensurations','ce que la balance ne dit pas','var(--m-gras)'],
    ['/paliers','medal','Paliers','ce que j’ai déjà franchi','var(--gold)'],
    ['/motivations','quote','Mes raisons','pourquoi je fais ça','var(--m-muscle)']
  ];
  if(m.sport){ items.push(['/sport','run','Sport','séances et régularité','var(--m-sport)']);
               items.push(['/planning','calendar','Planning','ce que j’ai prévu','var(--m-sport)']); }
  if(m.kcalIn) items.push(['/calories','plate','Calories','ce que je mange','var(--m-cal)']);
  if(m.pillbox) items.push(['/pilulier','pill','Pilulier','médicaments et compléments','var(--m-muscle)']);
  items.push(['/tableau','table','Tableau','tous mes chiffres','var(--tx-2)']);
  items.push(['/sauvegarde','save','Sauvegarde','ne rien perdre','var(--acc)']);
  items.push(['/metriques','layers','Mes mesures','que saisir chaque matin','var(--tx-2)']);
  items.push(['/reglages','settings','Réglages','profil, modules, thème','var(--tx-2)']);
  items.push(['/aide','help','Aide','comment ça marche','var(--tx-2)']);
  let h=head('Plus');
  h+='<div class="hub">'+items.map(i=>'<a class="hub-item" href="#'+i[0]+'">'
    +'<div class="hub-ic" style="color:'+i[4]+'">'+ic(i[1])+'</div>'
    +'<div class="hub-txt"><div class="hub-label">'+esc(i[2])+'</div><div class="hub-sub">'+esc(i[3])+'</div></div></a>').join('')+'</div>';
  const off=[];
  if(!m.sport) off.push(['sport','run','Sport & entraînements','noter tes séances, voir tes minutes, prévoir tes créneaux']);
  if(!m.kcalIn) off.push(['kcalIn','plate','Calories mangées','suivre ce que tu manges et comprendre le décalage avec le poids']);
  if(!m.pillbox) off.push(['pillbox','pill','Pilulier','médicaments, compléments, protéine — avec rappel du jour']);
  if(off.length){
    h+='<div class="section-title">Modules à activer</div><div class="list">'
     +off.map(o=>'<div class="row"><div class="row-ic">'+ic(o[1])+'</div>'
       +'<div class="row-main"><div class="row-title">'+esc(o[2])+'</div><div class="row-sub">'+esc(o[3])+'</div></div>'
       +'<button class="chip chip--act" data-act="mod-on" data-k="'+o[0]+'">Activer</button></div>').join('')+'</div>';
  }
  h+='<div class="small muted center" style="margin-top:20px">Élan v'+esc(state.meta.appVersion)+' · '
   +weighIns().length+' '+plural(weighIns().length,'pesée')+' · données locales</div>';
  return h;
}

/* ---------- Écran : Objectif ---------- */
function screenObjectif(){
  const g=state.settings.goal;
  let h=backHead('Mon objectif','/plus','<button class="btn-add" data-act="edit-goal">Modifier</button>');
  if(g.weightKg==null) return h+goalCTA();
  const pct=goalProgressPct()||0, lost=kgLost(), left=kgLeft(), ed=etaDays(), rate=bestRate();
  h+='<div class="card hero"><div class="hero-label">Objectif</div>'
   +'<div class="hero-value">'+fmtKg(g.weightKg)+'</div>'
   +'<div class="hero-sub">'+(left!=null?fmtKg(left)+' restants sur '+fmtKg((startWeight()||0)-g.weightKg):'')+'</div>'
   +'<div class="goalbar"><div class="goalbar-fill" data-bar="'+pct.toFixed(3)+'"></div></div>'
   +'<div class="goalbar-ticks"><span>'+fmtKg(startWeight())+'</span><span>'+Math.round(pct*100)+' %</span><span>'+fmtKg(g.weightKg)+'</span></div>'
   +'</div>';
  h+='<div class="stats stats-2" style="margin-top:12px">'
   +statCard('Perdu',sgnKg(lost!=null?-lost:null),equivShort(lost||0)||'',deltaClass(lost!=null?-lost:null,-1))
   +statCard('Rythme',rate!=null?fmtRate(rate):'—',rateWord(rate),deltaClass(rate,-1))
   +statCard('Date estimée',ed==null?'—':fmtDateShort(etaDate()),ed==null?'':'dans '+humanDuration(ed),'')
   +statCard('IMC visé',nf(bmiOf(g.weightKg),1),bmiCat(bmiOf(g.weightKg)),'')
   +'</div>';
  h+='<div class="card" style="margin-top:12px"><div class="small muted">'+esc(etaLine(ed,rate))+'</div></div>';
  if(g.date){
    const days=diffDays(isoToday(),g.date);
    const need=(left!=null&&days>0)?left/(days/7):null;
    if(need!=null){
      const refK=refWeight().kg||100;
      const pctWeek=need/refK*100;
      h+='<div class="insight'+(pctWeek>1?'':' insight--neutral')+'" style="margin-top:12px"><div class="insight-ic">'+ic('calendar')+'</div><div class="insight-txt">'
       +'Ta date cible (le '+esc(fmtDateShort(g.date))+', dans '+days+' jours) demande <strong>'+fmtKg(need)+' par semaine</strong>, soit '+nf(pctWeek,1)+' % de ton poids.'
       +(pctWeek>1?' C’est plus rapide que ce qui tient dans la durée — la date est peut-être à décaler.':' C’est un rythme tenable.')
       +'</div></div>';
    }
  }
  const nb=trendNow()!=null?nextBmiThreshold(trendNow()):null;
  if(nb) h+='<div class="card" style="margin-top:12px"><div class="row-title flex aic gap8">'+ic('gauge','ic--sm')+'Prochain seuil d’IMC</div>'
   +'<div class="small muted" style="margin-top:4px">Sous '+fmtKg(nb.kg)+', ton IMC passe sous '+nb.bmi+'. Il te reste '+fmtKg(nb.remainKg)+'.</div></div>';
  h+='<div class="section-title">Paliers</div>';
  const nm=nextMilestone();
  if(nm) h+='<div class="card"><div class="today-top"><div class="today-ic is-acc">'+ic(nm.def.icon)+'</div>'
   +'<div class="row-main"><div class="stat-label">Prochain palier</div><div class="row-title">'+esc(nm.def.label)+'</div>'
   +'<div class="small muted">'+esc(nm.remainText)+'</div></div></div>'
   +'<div class="bar" style="margin-top:10px"><span class="bar-seg" data-bar="'+nm.pct.toFixed(3)+'" style="background:var(--grad-brand)"></span></div></div>';
  h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/paliers" style="margin-top:10px">Voir tous les paliers</button>';
  return h;
}
function goalEditor(){
  const g=state.settings.goal, cur=trendNow()||mv(lastWeighIn(),'weight')||100;
  openSheet('Mon objectif',
    '<div class="field"><label>Poids visé (kg)</label><input class="input tnum" id="gWeight" inputmode="decimal" value="'+(g.weightKg!=null?nf(g.weightKg,1):'')+'" placeholder="'+nf(cur*0.9,1)+'">'
    +'<div class="chip-row" style="margin-top:8px">'
    +[[0.95,'−5 %'],[0.9,'−10 %'],[0.85,'−15 %']].map(o=>'<button class="chip" data-act="goal-preset" data-v="'+(Math.round(cur*o[0]*10)/10)+'">'+o[1]+' · '+nf(cur*o[0],1)+' kg</button>').join('')
    +[25,30].filter(b=>weightForBmi(b)<cur).map(b=>'<button class="chip" data-act="goal-preset" data-v="'+(Math.round(weightForBmi(b)*10)/10)+'">IMC '+b+' · '+nf(weightForBmi(b),1)+' kg</button>').join('')
    +'</div><div class="hint" id="gHint"></div></div>'
    +'<div class="field"><label>Date cible (facultatif)</label><input class="input" type="date" id="gDate" value="'+(g.date||'')+'">'
    +'<div class="hint">Laisse vide pour que l’app estime la date à partir de ton rythme réel.</div></div>'
    +(metricOn('fat')?'<div class="field"><label>Masse grasse visée (%) — facultatif</label><input class="input tnum" id="gFat" inputmode="decimal" value="'+(g.fatPct!=null?nf(g.fatPct,1):'')+'"></div>':'')
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="goal-save">Enregistrer</button>'
    +(g.weightKg!=null?'<button class="btn btn--ghost btn--block" data-act="goal-clear" style="margin-top:8px">Retirer l’objectif</button>':'')
    +'</div>');
}
function saveGoal(){
  const g=x=>{ const el=document.getElementById(x); return el?el.value:''; };
  const w=parseNum(g('gWeight'));
  if(w==null||w<30||w>350){ toast('Indique un poids visé plausible'); return; }
  state.settings.goal.weightKg=Math.round(w*10)/10;
  state.settings.goal.date=g('gDate')||null;
  const f=parseNum(g('gFat')); state.settings.goal.fatPct=(f!=null&&f>3&&f<70)?f:null;
  closeSheet(); update(); toast('Objectif enregistré');
  setTimeout(()=>checkMilestones({celebrate:true}),300);
}

/* ---------- Écran : Paliers ---------- */
function screenPaliers(){
  const done=(state.milestones||[]).filter(m=>defByCode(m.code)).sort((a,b)=>a.reachedAt<b.reachedAt?1:-1);
  let h=backHead('Paliers','/plus');
  const nm=nextMilestone();
  if(nm) h+='<div class="card card--accent"><div class="today-top"><div class="today-ic is-acc">'+ic(nm.def.icon)+'</div>'
   +'<div class="row-main"><div class="stat-label">Prochain palier</div><div class="row-title">'+esc(nm.def.label)+'</div>'
   +'<div class="small muted">'+esc(nm.remainText)+'</div></div></div>'
   +'<div class="bar" style="margin-top:10px"><span class="bar-seg" data-bar="'+nm.pct.toFixed(3)+'" style="background:var(--grad-brand)"></span></div></div>';
  if(!done.length) return h+empty('medal','Aucun palier franchi pour l’instant','Ils arriveront. Le premier est souvent le plus beau.');
  h+='<div class="section-title">'+done.length+' '+plural(done.length,'palier')+' '+plural(done.length,'franchi')+'</div><div class="list">'
   +done.map(m=>{ const d=defByCode(m.code);
     return '<div class="row"><div class="row-ic" style="color:var(--gold)">'+ic(d.icon)+'</div>'
      +'<div class="row-main"><div class="row-title">'+esc(d.label)+'</div>'
      +'<div class="row-sub">le '+esc(fmtDateLong(m.reachedAt))+'</div></div></div>'; }).join('')
   +'</div>';
  return h;
}

/* ---------- Écran : Motivations ---------- */
function screenMotivations(){
  const l=state.motivations||[];
  let h=backHead('Mes raisons','/plus','<button class="btn-add" data-act="add-motivation">+ Ajouter</button>');
  if(!l.length) return h+empty('quote','Aucune raison écrite pour l’instant','Une phrase suffit. Elle reviendra te voir les matins où la balance ne bouge pas.',
    '<button class="btn btn--primary" data-act="add-motivation">Écrire ma raison</button>');
  h+='<div class="list">'+l.map(m=>'<div class="row" data-act="edit-motivation" data-id="'+m.id+'">'
    +'<div class="row-ic row-ic--emoji">'+uem(m.emoji||'💭')+'</div>'
    +'<div class="row-main"><div class="row-title" style="white-space:normal">'+esc(m.text)+'</div></div>'+arrowHTML()+'</div>').join('')+'</div>';
  h+='<div class="hint" style="margin-top:12px">Une raison est affichée chaque matin sur l’accueil, à tour de rôle.</div>';
  return h;
}
const MOTIV_EMOJI=['💭','⚽','👕','🏃','❤️','👶','📸','🧗','✈️','💪','😤','🩺','🏔️','🎽'];
function motivationEditor(id){
  const m=id?(state.motivations||[]).find(x=>x.id===id):null;
  openSheet(m?'Modifier ma raison':'Pourquoi tu fais ça ?',
    '<div class="field"><textarea class="input" id="mvText" style="min-height:90px" placeholder="Ex. : « Monter les escaliers sans souffler », « Rentrer dans ma veste préférée », « Tenir tout un match de badminton »">'+esc(m?m.text:'')+'</textarea></div>'
    +'<div class="chip-wrap">'+MOTIV_EMOJI.map(e=>'<button class="chip'+((m?m.emoji:'💭')===e?' is-active':'')+'" data-act="mv-emoji" data-emoji="'+e+'">'+uem(e)+'</button>').join('')+'</div>'
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="save-motivation" data-id="'+(id||'')+'">Enregistrer</button>'
    +(id?'<button class="btn btn--danger btn--block" data-act="del-motivation" data-id="'+id+'" style="margin-top:8px">Supprimer</button>':'')
    +'</div>');
}

/* ---------- Écran : Analyse ---------- */
function screenAnalyse(){
  let h=backHead('Analyse','/plus');
  const nW=weighIns().length;
  if(nW<4){
    return h+empty('microscope','Pas encore de quoi analyser',
      nW===0?'Cet écran croise ton poids, ta composition, ton sport et ce que tu manges. Il lui faut d’abord quelques matins de pesée.'
            :'Encore '+(4-nW)+' '+plural(4-nW,'pesée')+' et je commence à croiser tes chiffres. Rien ne presse : une par matin suffit.',
      '<button class="btn btn--primary" data-act="weigh-in">'+ic('scale')+'Saisir ma pesée</button>');
  }
  const cov=coverage(30);
  if(cov<0.40){ const n30=windowOf(serieW(),isoToday(),30).length;
    h+='<div class="card card--warn"><div class="small muted">Tu as '+n30+' '+plural(n30,'pesée')
      +' sur les 30 derniers jours. Les analyses ci-dessous sont indicatives.</div></div>'; }
  const list=buildInsights().filter(i=>i.prio<99&&(cov>=0.40||i.prio>=70));
  if(list.length){
    h+='<div class="section-title">Ce que disent tes chiffres</div>';
    h+=list.slice(0,10).map(i=>'<div class="insight'+(i.tone==='pos'?'':' insight--neutral')+'" style="margin-bottom:10px">'
      +'<div class="insight-ic">'+ic(i.icon||'bulb')+'</div><div class="insight-txt">'+esc(i.text)+'</div></div>').join('');
  }
  /* Composition : la vraie réponse à « le % ne veut pas dire grand-chose ». */
  const dw=compDelta(PICK_W,28), df=metricOn('fat')?compDelta(PICK_FATK,28):{ok:false}, dp=compDelta(PICK_FATP,28);
  if(metricOn('fat')){
  h+='<div class="section-title">Ton corps sur 28 jours</div>';
  if(dw.ok&&df.ok){
    const it=interpretComposition(dw.delta,df.delta,dp.ok?dp.delta:0);
    h+='<div class="card"><div class="stats stats-2">'
     +statCard('Poids',sgnKg(dw.delta),'','')
     +statCard('Masse grasse',sgnKg(df.delta),dp.ok?sgnPt(dp.delta):'','')
     +statCard('Masse maigre',sgnKg(dw.delta-df.delta),'','')
     +statCard('Mesures',String(df.n),'sur 28 jours','')
     +'</div><div class="small" style="margin-top:12px;line-height:1.5">'+esc(it.text)+'</div>'
     +'<div class="hint" style="margin-top:8px">Le % de masse grasse est un rapport : il peut baisser juste parce que ton poids baisse. Ce qui compte, ce sont les kilos de gras. (mesure d’impédance : à lire en tendance)</div></div>';
    const q=lossQuality(28);
    if(q.ok) h+='<div class="card"><div class="row-title">Qualité de la perte</div>'
     +'<div class="bar" style="margin-top:10px"><span class="bar-seg" data-bar="'+q.ratio.toFixed(2)+'" style="background:var(--grad-brand)"></span></div>'
     +'<div class="small muted" style="margin-top:8px">Sur 28 jours : '+fmtKg(q.lossKg)+' perdus, dont <b>'+fmtKg(q.fatKg)+' de graisse</b> ('+q.pct+' %). Qualité de perte '+esc(q.label)+'.</div></div>';
  } else h+='<div class="card"><div class="small muted">Il faut au moins deux semaines de mesures de composition pour dire quoi que ce soit d’honnête. On y sera bientôt.</div></div>';
  }

  /* Bilan énergétique — le coeur de l'écran : ton point neutre, d'où tout découle. */
  h+='<div class="section-title">Ton énergie</div>';
  const bmr=bmrMifflin(refWeight().kg,state.settings.profile.heightCm,profileAge(),state.settings.profile.sex);
  const af=activityFactor(), tdee=tdeeTheo(), obs=tdeeObserved(), scale=lastScaleKcal(), maint=maintenanceKcal();
  const showScale=metricOn('kcalOut')&&scale!=null;
  if(maint.kcal!=null){
    h+='<div class="card card--accent tap" data-act="go" data-route="/simulateur">'
     +'<div class="flex between aic"><div><div class="stat-label">Ton point neutre</div>'
     +'<div class="hero-value tnum" style="font-size:34px;margin:2px 0 0"><span data-count="'+maint.kcal+'" data-dec="0">'+nf(maint.kcal,0)+'</span><span class="hero-unit">kcal/j</span></div></div>'
     +(maint.source==='observé'?'<span class="badge badge--ok">mesuré sur toi</span>':'<span class="badge">estimé</span>')+'</div>'
     +'<div class="small muted" style="margin-top:8px">C’est le nombre de calories où ton poids ne bouge ni dans un sens ni dans l’autre. En dessous, tu perds ; au-dessus, tu prends. '+esc(capit(maint.why))+'.</div>'
     +'<div class="btn btn--ghost btn--block" style="margin-top:12px">'+ic('calculator')+'Ouvrir le simulateur</div></div>';
  }
  h+='<div class="card" style="margin-top:12px"><div class="row-title">D’où vient ce chiffre</div>'
   +'<div class="calc-list" style="margin-top:10px">'
   +'<div class="calc-row"><span class="calc-k">Métabolisme au repos<span class="calc-sub">ton corps immobile, 24 h</span></span><span class="calc-v tnum">'+(bmr!=null?nf(bmr,0):'—')+'</span></div>'
   +(af.manual
     ?'<div class="calc-row"><span class="calc-k">Niveau d’activité<span class="calc-sub">réglage manuel</span></span><span class="calc-v tnum">×'+nf(af.f,2)+'</span></div>'
     :'<div class="calc-row"><span class="calc-k">'+esc(af.job.label)+'<span class="calc-sub">tes journées hors sport</span></span><span class="calc-v tnum">×'+nf(af.base,2)+'</span></div>'
      +'<div class="calc-row"><span class="calc-k">Tes séances<span class="calc-sub">'+(af.sport>0?nf(sportKcalPerDay(28),0)+' kcal/jour en moyenne':'aucune séance sur 28 jours')+'</span></span><span class="calc-v tnum">'+(af.sport>0?'+'+nf(af.sport,2):'—')+'</span></div>')
   +'<div class="calc-row is-total"><span class="calc-k">Dépense estimée</span><span class="calc-v tnum">'+(tdee!=null?nf(tdee,0)+' kcal':'—')+'</span></div>'
   +(obs.ok?'<div class="calc-row is-total"><span class="calc-k">Dépense <b>observée</b><span class="calc-sub">ce que tes chiffres racontent vraiment</span></span><span class="calc-v tnum">'+nf(obs.kcal,0)+' kcal</span></div>':'')
   +'</div>';
  if(obs.ok){
    const ecart=obs.kcal-tdee;
    h+='<div class="small muted" style="margin-top:10px;line-height:1.5">Tu manges <b>'+nf(obs.intake,0)+' kcal/jour</b> en moyenne et tu perds '+fmtKg(-obs.kgWeek)+' par semaine. '
     +'Ces deux chiffres ensemble donnent ta dépense réelle : <b>'+nf(obs.kcal,0)+' kcal</b>'
     +(Math.abs(ecart)>150?(', soit '+nf(Math.abs(ecart),0)+' de '+(ecart>0?'plus':'moins')+' que la formule. C’est le tien qui compte.'):'. La formule tombe juste, c’est plutôt bon signe.')+'</div>'
     +'<div class="hint" style="margin-top:8px">Calcul indirect : si tu sous-estimes tes portions dans Yazio, ce chiffre est sous-estimé d’autant.</div>';
  }
  else if(state.settings.modules.kcalIn) h+='<div class="hint" style="margin-top:10px">Pour mesurer ta dépense réelle il faut quatorze jours de calories et dix pesées sur les vingt-huit derniers jours — tu en as '+(obs.nK||0)+' et '+(obs.nW||0)+'.</div>';
  if(showScale&&bmr!=null){
    h+='<div class="divider"></div><div class="small muted">Ta balance annonce '+nf(scale,0)+' kcal/jour, ce qui supposerait un facteur d’activité de '+nf(scale/bmr,2)
     +' — un métier physique <i>plus</i> du sport tous les jours. Une balance ne mesure pas ta dépense : elle la devine à partir de ton poids.</div>';
  }
  h+='</div>';
  if(!state.settings.modules.kcalIn) h+='<div class="card"><div class="small muted">Active le module <b>Calories mangées</b> pour découvrir ta dépense réelle — c’est le calcul le plus parlant de l’app.</div>'
   +'<button class="btn btn--ghost btn--block" data-act="mod-on" data-k="kcalIn" style="margin-top:10px">Activer les calories</button></div>';

  /* Protéines : le levier le plus déterminant en déficit, donc juste après l'énergie. */
  h+=analyseProteines();

  /* Jour de la semaine */
  const wd=weekdayEffect();
  h+='<div class="section-title">Ta semaine</div>';
  if(wd.ok){
    const mxa=Math.max.apply(null,wd.rows.filter(r=>r.mean!=null).map(r=>Math.abs(r.mean)).concat([0.1]));
    h+='<div class="card"><div class="chart-bars">'
     +[1,2,3,4,5,6,0].map(i=>{ const r=wd.rows[i];
       const v=r.mean==null?0:r.mean;
       const txt=r.mean==null?'—':((v>0?'+':MINUS)+nf(Math.abs(v),2)+NBSP+'kg');
       return '<div><div class="cbtop"><span>'+esc(capit(r.label))+'</span><span class="tnum muted">'+txt+'</span></div>'
        +'<div class="chart-bar-track"><div class="chart-bar-fill" data-bar="'+(Math.abs(v)/mxa).toFixed(2)+'" style="background:'+(v>0?'var(--up)':'var(--down)')+'"></div></div></div>'; }).join('')
     +'</div>'
     +'<div class="small muted" style="margin-top:10px">'+esc(wd.notable
        ?('Ton poids du '+wd.hi.label+' est en moyenne '+fmtKg(wd.gap)+' au-dessus de ton '+wd.lo.label+'. C’est le rythme de ta semaine, pas de la graisse qui apparaît et disparaît.')
        :'Aucun jour ne sort du lot : ton poids est régulier sur la semaine.')+'</div></div>';
  } else h+='<div class="card"><div class="small muted">Pas encore assez de pesées réparties sur la semaine ('+wd.n+').</div></div>';

  const sg=noiseSigma();
  h+='<div class="card" style="margin-top:12px"><div class="row-title flex aic gap8">'+ic('ruler','ic--sm')+'Ton bruit naturel</div>'
   +'<div class="small muted" style="margin-top:4px">Ton poids bouge naturellement de ±'+fmtKg(sg.sigma)+' d’un jour à l’autre'
   +(sg.estimated?' (mesuré sur tes '+sg.n+' dernières pesées)':' (estimation par défaut)')
   +'. En dessous de cet écart, ce n’est pas un vrai changement.</div></div>';
  h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/astuces" style="margin-top:14px">'+ic('toolbox')+'Ma boîte à outils</button>';
  h+='<div class="hint" style="margin-top:12px">Élan décrit tes chiffres. Pour toute question de santé, parles-en à un professionnel.</div>';
  return h;
}

/* ============================================================
   ÉCRAN : MENSURATIONS
   ------------------------------------------------------------
   Ce que la balance ne peut pas dire. Quand on remplace du gras
   par du muscle, le poids ne bouge pas — le tour de taille, si.
   C'est aussi la mesure qui suit le mieux la graisse du ventre,
   celle qui compte vraiment pour la santé.

   Le repère central est le RAPPORT TOUR DE TAILLE / HAUTEUR
   (WHtR) : « garde ton tour de taille sous la moitié de ta
   taille ». Il vaut mieux que l'IMC parce qu'il ne confond pas
   un corps musclé avec un corps gras, et il marche à toutes les
   morphologies.

   Ton : un repère, jamais un verdict. Rien n'est rouge, aucun
   conseil médical, et la taille d'échantillon est toujours dite.
   ============================================================ */
const TAPE_KEYS=['waist','hips','chest','arm','thigh','neck'];
/* Seuils de tour de taille (repères usuels européens, hommes / femmes). */
const WAIST_MARKS={m:[94,102], f:[80,88]};
/* Rapport taille/hauteur — quatre zones, décrites sans dramatiser. */
function whtrZone(v){
  if(v==null) return null;
  if(v<0.40) return {code:'bas',   label:'sous la zone habituelle', cls:'flat'};
  if(v<0.50) return {code:'ok',    label:'dans la zone saine',      cls:'down'};
  if(v<0.60) return {code:'haut',  label:'au-dessus du repère',     cls:'flat'};
  return             {code:'thaut', label:'nettement au-dessus',    cls:'flat'};
}
function whtrNow(){
  const cm=state.settings.profile.heightCm;
  const e=lastWithMetric('waist');
  if(!cm||!e) return null;
  const w=mv(e,'waist');
  if(w==null) return null;
  return {v:Math.round(w/cm*1000)/1000, waist:w, date:e.date, heightCm:cm};
}
/* La dernière pesée qui porte cette mesure — les mensurations sont prises
   toutes les deux ou trois semaines, pas tous les matins. */
function lastWithMetric(k){
  for(let i=state.entries.length-1;i>=0;i--){ if(mv(state.entries[i],k)!=null) return state.entries[i]; }
  return null;
}
function firstWithMetric(k){
  for(let i=0;i<state.entries.length;i++){ if(mv(state.entries[i],k)!=null) return state.entries[i]; }
  return null;
}
function tapeStats(k){
  const a=firstWithMetric(k), b=lastWithMetric(k);
  if(!b) return null;
  const va=a?mv(a,k):null, vb=mv(b,k);
  const n=state.entries.filter(e=>mv(e,k)!=null).length;
  return {key:k,first:a,last:b,v:vb,delta:(a&&a!==b&&va!=null)?Math.round((vb-va)*10)/10:null,
          since:a?a.date:null,date:b.date,n:n};
}
function screenMensurations(){
  const on=TAPE_KEYS.filter(metricOn);
  let h=backHead('Mensurations','/plus',
    on.length?'<button class="btn-add" data-act="meas-add">'+ic('plus','ic--sm')+'Noter</button>':'');
  if(!on.length){
    return h+empty('ruler','Le mètre ruban n’est pas activé',
      'Quand tu remplaces du gras par du muscle, la balance ne bouge pas — le tour de taille, si. C’est aussi la mesure la plus parlante pour la santé.',
      '<button class="btn btn--primary" data-act="metric-on" data-k="waist">Activer le tour de taille</button>')
      +measGuide();
  }
  const stats=on.map(tapeStats).filter(Boolean);
  if(!stats.length){
    return h+empty('ruler','Aucune mesure enregistrée',
      'Prends tes mesures le matin, à jeun, avant de boire. Une fois toutes les deux ou trois semaines suffit : ça bouge lentement, et c’est tant mieux.',
      '<button class="btn btn--primary" data-act="meas-add">'+ic('ruler')+'Prendre mes mesures</button>')
      +measGuide();
  }

  /* ---- Le rapport taille / hauteur ---- */
  const wr=whtrNow();
  if(wr){
    const z=whtrZone(wr.v), cible=Math.round(wr.heightCm*0.5*10)/10;
    const reste=Math.round((wr.waist-cible)*10)/10;
    h+='<div class="card hero">'
     +'<div class="hero-label">Tour de taille</div>'
     +'<div class="hero-value tnum"><span data-count="'+wr.waist.toFixed(1)+'" data-dec="1">'+nf(wr.waist,1)+'</span><span class="hero-unit">cm</span></div>'
     +'<div class="hero-sub">mesuré le '+esc(fmtDateShort(wr.date))+'</div>'
     +'<div class="whtr">'
     +'<div class="whtr-top"><span>0,40</span><span class="whtr-mid">tour de taille ÷ hauteur</span><span>0,65</span></div>'
     +'<div class="whtr-track">'
     +'<span class="whtr-zone whtr-ok"></span>'
     +'<span class="whtr-mark"><b>0,50</b></span>'
     +'<span class="whtr-cursor" style="left:'+r1(clamp((wr.v-0.40)/0.25,0,1)*100)+'%"></span></div>'
     +'<div class="whtr-val '+z.cls+'">'+nf(wr.v,2)+' — '+esc(z.label)+'</div></div>'
     +'<div class="small muted" style="margin-top:10px;text-align:left">'
     +(z.code==='ok'
        ?'Ton tour de taille est sous la moitié de ta hauteur ('+nf(cible,1)+' cm). C’est le repère le plus simple qui existe, et tu es du bon côté.'
        :(z.code==='bas'
          ?'Ton tour de taille est très bas par rapport à ta hauteur. Ce n’est pas une cible à poursuivre plus loin.'
          :'Le repère simple tient en une phrase : <i>tour de taille sous la moitié de la hauteur</i> — pour toi, <b>'+nf(cible,1)+' cm</b>. '
           +'Tu en es à '+nf(reste,1)+' cm, et chaque centimètre compte : ce rapport vaut mieux que l’IMC, il ne confond pas un corps musclé avec un corps gras.'))
     +'</div></div>';
    const marks=WAIST_MARKS[state.settings.profile.sex==='f'?'f':'m'];
    if(wr.waist>=marks[0]) h+='<div class="card" style="margin-top:10px"><div class="small muted">'
      +'Les repères usuels situent l’attention à partir de '+marks[0]+' cm et plus nettement à partir de '+marks[1]+' cm. '
      +'Ce sont des moyennes de population, pas un diagnostic : seul ton médecin peut en tirer une conclusion te concernant.'
      +'</div></div>';
  } else if(metricOn('waist')&&!state.settings.profile.heightCm){
    h+='<div class="card"><div class="small muted">Renseigne ta taille pour voir ton rapport tour de taille / hauteur.</div>'
     +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/reglages" style="margin-top:10px">Renseigner ma taille</button></div>';
  }

  /* ---- Chaque mesure, avec son évolution ---- */
  h+='<div class="section-title">Tes mesures</div><div class="list">';
  stats.forEach(st=>{
    const M=METRICS[st.key];
    const dcls=st.delta==null?'delta--flat':signCls(st.delta,M.better);
    const age=diffDays(st.date,isoToday());
    h+='<div class="row" data-act="meas-add" data-k="'+st.key+'">'
     +'<div class="row-ic" style="color:'+M.color+'">'+ic(M.icon)+'</div>'
     +'<div class="row-main"><div class="row-title">'+esc(M.label)+'</div>'
     +'<div class="row-sub">'+(age===0?'aujourd’hui':(age===1?'hier':'il y a '+age+' jours'))
     +(st.n>1?' · '+st.n+' mesures':'')+'</div></div>'
     +'<div style="text-align:right;flex:none"><div class="row-amt tnum">'+nf(st.v,1)+'<span class="muted" style="font-size:12px"> cm</span></div>'
     +(st.delta!=null?'<div class="small '+dcls+'">'+(st.delta>0?'+':(st.delta<0?MINUS:''))+nf(Math.abs(st.delta),1)+' cm</div>':'')
     +'</div></div>';
  });
  h+='</div>';

  /* ---- La courbe du tour de taille, quand il y a de quoi tracer ---- */
  const wst=stats.find(x=>x.key==='waist');
  if(wst&&wst.n>=3){
    const pts=seriesPoints('waist','cm',wst.since,isoToday());
    /* Même câblage que les Courbes : l'identifiant doit être donné À LA FOIS à
       lineChart (pour la zone de lecture) et à chartSlot (pour le scrubber). */
    h+='<div class="chart-card"><div class="chart-title">Tour de taille</div>'
     +'<div class="chart-readout" id="ro-meas-waist" aria-live="polite">'+chReadoutDefault(pts,'waist','cm')+'</div>'
     +chartSlot(w=>lineChart([{key:'waist',label:'Tour de taille',color:METRICS.waist.color,unit:'cm',dec:1,points:pts}],
        {w:w,h:CH_H,from:pts[0].date,to:isoToday(),id:'meas-waist',readoutId:'ro-meas-waist',
         scrub:true,yUnit:'cm',gap:45}),{h:CH_H,scrub:true,id:'meas-waist'})
     +'</div>';
    if(wst.delta!=null&&wst.delta<-1){
      const kg=kgLost();
      h+='<div class="insight" style="margin-top:12px"><div class="insight-ic">'+ic('ruler')+'</div>'
       +'<div class="insight-txt">Tu as perdu <b>'+nf(-wst.delta,1)+' cm</b> de tour de taille'
       +(kg!=null&&kg>0?' pour '+fmtKg(kg)+' sur la balance':'')+'. '
       +'C’est la graisse du ventre qui part en premier quand on est en déficit — et c’est la meilleure nouvelle de ton suivi.</div></div>';
    }
  }

  /* ---- Rapport taille / hanches, si les deux sont là ---- */
  const hp=stats.find(x=>x.key==='hips');
  if(wst&&hp){
    const rth=Math.round(wst.v/hp.v*100)/100;
    h+='<div class="card" style="margin-top:12px"><div class="row-title flex aic gap8">'+ic('layers','ic--sm')+'Taille / hanches</div>'
     +'<div class="kv" style="margin-top:8px"><span class="kv-k">Rapport</span><span class="kv-v tnum">'+nf(rth,2)+'</span></div>'
     +'<div class="small muted" style="margin-top:8px">Il dit <i>où</i> se loge la graisse. Plus il baisse, plus la répartition se déplace du ventre vers le reste — '
     +'ce qui compte davantage que le chiffre absolu.</div></div>';
  }

  /* ---- Les autres mesures activables ---- */
  const off=TAPE_KEYS.filter(k=>!metricOn(k));
  if(off.length){
    h+='<div class="section-title">Ajouter une mesure</div><div class="chip-wrap">'
     +off.map(k=>'<button class="chip chip--act" data-act="metric-on" data-k="'+k+'">'
        +ic('plus','ic--sm')+esc(METRICS[k].label)+'</button>').join('')+'</div>';
  }
  return h+measGuide();
}
/* Comment mesurer — la moitié de la fiabilité vient du protocole, pas du mètre. */
function measGuide(){
  return '<div class="section-title">Bien mesurer</div>'
   +'<details class="acc"><summary class="acc-sum"><span class="acc-ic">'+ic('ruler')+'</span>'
   +'<span class="acc-t"><b>Le protocole en cinq points</b></span><span class="acc-ch"></span></summary>'
   +'<div class="acc-body"><ol class="tip-ol">'
   +'<li><b>Le matin, à jeun</b>, avant de boire et après être passé aux toilettes. Comme la pesée.</li>'
   +'<li><b>Au niveau du nombril</b> pour la taille — pas au plus fin. Le repère doit être reproductible, pas flatteur.</li>'
   +'<li><b>Debout, détendu, expire normalement.</b> Ne rentre pas le ventre : tu mesurerais ta volonté, pas ton corps.</li>'
   +'<li><b>Le mètre à plat</b>, parallèle au sol, serré sans creuser la peau.</li>'
   +'<li><b>Toujours le même mètre</b>, et note dans la foulée. Deux mesures d’affilée qui diffèrent de plus d’un centimètre : recommence.</li>'
   +'</ol><p class="tip-note">Une fois toutes les deux ou trois semaines suffit largement. Le tour de taille bouge lentement — '
   +'le mesurer tous les jours n’apporterait que du bruit.</p></div></details>'
   +'<details class="acc"><summary class="acc-sum"><span class="acc-ic">'+ic('gauge')+'</span>'
   +'<span class="acc-t"><b>Pourquoi ce rapport plutôt que l’IMC</b></span><span class="acc-ch"></span></summary>'
   +'<div class="acc-body"><p>L’IMC ne connaît que ton poids et ta taille. Il classe un rugbyman musclé et une personne sédentaire '
   +'du même gabarit exactement pareil, parce qu’il ne sait pas <i>de quoi</i> tu es fait.</p>'
   +'<p>Le rapport <b>tour de taille ÷ hauteur</b> regarde là où la graisse pose vraiment un problème : autour des organes. '
   +'Il tient sur une seule phrase — <i>garde ton tour de taille sous la moitié de ta taille</i> — et il fonctionne quelle que soit ta morphologie.</p>'
   +'<p class="tip-note">Ni l’un ni l’autre n’est un diagnostic. Ce sont des repères pour suivre une direction, pas pour se juger.</p>'
   +'</div></details>';
}

/* ============================================================
   ÉCRAN : MA SEMAINE
   ------------------------------------------------------------
   Le quotidien montre le bruit ; la semaine montre le signal.
   Sept jours, c'est assez long pour que l'eau, le sel et une
   grosse séance se compensent, et assez court pour qu'on se
   souvienne de ce qui s'est passé.

   Trois principes tenus ici :
   • On compare des TENDANCES, pas deux pesées isolées : la
     différence entre le lundi et le dimanche dépend surtout du
     repas du samedi soir.
   • On ne juge jamais une semaine en cours. Tant qu'elle n'est
     pas finie, on annonce « en cours », pas un bilan.
   • Aucun jour n'est « mauvais ». On nomme le jour le plus léger,
     jamais le plus lourd.
   ============================================================ */
function weekOfUI(){
  const w=state.ui.weekStart;
  return (validYMD(w))?weekStartYMD(w):weekStartYMD(isoToday());
}
/* Tout ce qu'on sait d'une semaine, en un objet. */
function weekReport(mon){
  const sun=addDayYMD(mon,6), today=isoToday();
  const enCours=sun>=today;
  const last=minYMD(sun,today);
  const days=[];
  for(let i=0;i<7;i++){
    const d=addDayYMD(mon,i);
    const e=entryFor(d);
    days.push({date:d, w:e?mv(e,'weight'):null, kcal:e?mv(e,'kcalIn'):null,
               futur:d>today, note:e&&e.note?e.note:null,
               saute:!!(state.ui.skippedDays||{})[d]});
  }
  const pesees=days.filter(d=>d.w!=null);
  /* La variation de la semaine se lit sur la TENDANCE, pas sur deux pesées.
     Repli sur la première et la dernière pesée quand la tendance manque. */
  const tA=trendAt(addDayYMD(mon,-1)), tB=trendAt(last);
  let delta=null, source='tendance';
  if(tA!=null&&tB!=null) delta=Math.round((tB-tA)*100)/100;
  else if(pesees.length>=2){ delta=Math.round((pesees[pesees.length-1].w-pesees[0].w)*100)/100; source='pesees'; }
  const vals=pesees.map(d=>d.w);
  const moy=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const plusLeger=pesees.length?pesees.reduce((a,b)=>b.w<a.w?b:a):null;
  const ecart=vals.length>1?(Math.max.apply(null,vals)-Math.min.apply(null,vals)):null;
  const kcals=days.filter(d=>d.kcal!=null).map(d=>d.kcal);
  const kcalMoy=kcals.length?Math.round(kcals.reduce((a,b)=>a+b,0)/kcals.length):null;
  let sportMin=0, sportN=0;
  if(state.settings.modules.sport){
    const ss=sessionsInRange(mon,last);
    sportN=ss.length; sportMin=ss.reduce((a,x)=>a+(x.durationMin||0),0);
  }
  let pill=null;
  if(state.settings.modules.pillbox){
    let exp=0,tak=0,nj=0;
    for(let i=0;i<7;i++){ const d=addDayYMD(mon,i); if(d>today) break;
      const c=pillDayCounts(d); if(c.partial||!c.expected) continue;
      exp+=c.expected; tak+=Math.min(c.taken,c.expected); nj++; }
    if(exp) pill={pct:Math.round(tak/exp*100),jours:nj};
  }
  return {mon:mon,sun:sun,enCours:enCours,last:last,days:days,pesees:pesees.length,
          delta:delta,source:source,moy:moy,plusLeger:plusLeger,ecart:ecart,
          kcalMoy:kcalMoy,kcalJours:kcals.length,sportMin:sportMin,sportN:sportN,pill:pill,
          notes:days.filter(d=>d.note).length};
}
function weekLabel(mon){
  const sun=addDayYMD(mon,6), t=weekStartYMD(isoToday());
  if(mon===t) return 'Cette semaine';
  if(mon===addDayYMD(t,-7)) return 'La semaine dernière';
  const a=parseYMD(mon), b=parseYMD(sun);
  const sameMonth=a.getMonth()===b.getMonth();
  return 'Du '+a.getDate()+(sameMonth?'':' '+MOIS3[a.getMonth()])+' au '+b.getDate()+' '+MOIS3[b.getMonth()];
}
function screenSemaine(){
  const mon=weekOfUI(), r=weekReport(mon), t=weekStartYMD(isoToday());
  const first=firstEntry();
  const canPrev=!first||mon>weekStartYMD(first.date);
  const canNext=mon<t;
  let h=backHead('Ma semaine','/plus');
  h+='<div class="wknav">'
   +'<button class="icon-btn'+(canPrev?'':' is-off')+'" data-act="wk-prev" aria-label="Semaine précédente">'+ic('back')+'</button>'
   +'<div class="wknav-mid"><div class="wknav-t">'+esc(weekLabel(mon))+'</div>'
   +'<div class="wknav-s">'+esc(fmtDateShort(mon))+' – '+esc(fmtDateShort(r.sun))+'</div></div>'
   +'<button class="icon-btn'+(canNext?'':' is-off')+'" data-act="wk-next" aria-label="Semaine suivante">'+ic('chevron')+'</button>'
   +'</div>';

  if(!r.pesees){
    h+=empty('calendar','Aucune pesée cette semaine-là',
      mon===t?'La semaine commence à peine. Une pesée et le bilan apparaît.'
             :'Rien n’a été noté du '+fmtDateShort(mon)+' au '+fmtDateShort(r.sun)+'. Ce n’est pas grave : les trous ne faussent pas ta tendance.',
      mon===t?'<button class="btn btn--primary" data-act="weigh-in">'+ic('scale')+'Peser maintenant</button>':'');
    return h+weekJump(mon,t);
  }

  /* ---- Le chiffre de la semaine ---- */
  h+='<div class="card hero">'
   +'<div class="hero-label">'+(r.enCours?'Depuis lundi':'Sur la semaine')+'</div>'
   +'<div class="hero-value tnum '+(r.delta==null?'':deltaClass(r.delta,-1))+'">'
   +(r.delta==null?'—':sgnKg(r.delta))+'</div>'
   +'<div class="hero-sub">'+esc(weekVerdict(r))+'</div>'
   +weekStrip(r)+'</div>';

  /* ---- Les chiffres ---- */
  const ecoules=r.enCours?(diffDays(mon,r.last)+1):7;
  const cells=[statCard('Pesées',r.pesees+'/7',
                        r.enCours?(ecoules+' '+plural(ecoules,'jour')+' '+plural(ecoules,'écoulé'))
                                 :(r.pesees>=6?'régularité au top':(r.pesees>=4?'bonne base':'peu de points')),'')];
  if(r.moy!=null) cells.push(statCard('Poids moyen',fmtKg(r.moy),'sur '+r.pesees+' '+plural(r.pesees,'jour'),''));
  if(r.ecart!=null) cells.push(statCard('Amplitude',nf(r.ecart,1)+NBSP+'kg','du plus léger au plus lourd',''));
  if(r.kcalMoy!=null) cells.push(statCard('Calories/jour',nf(r.kcalMoy,0),r.kcalJours+' '+plural(r.kcalJours,'jour')+' '+plural(r.kcalJours,'noté'),''));
  /* Une semaine sans sport ou sans pilulier ne fabrique PAS une carte à zéro :
     un « 0 % » en gros au milieu de l'écran est un reproche, pas une information.
     Le récit, lui, en parle avec des mots. */
  if(r.sportMin>0) cells.push(statCard('Sport',fmtMin(r.sportMin),r.sportN+' '+plural(r.sportN,'séance'),''));
  if(r.pill&&r.pill.pct>0) cells.push(statCard('Pilulier',r.pill.pct+' %','sur '+r.pill.jours+' '+plural(r.pill.jours,'jour'),''));
  const shown=cells.slice(0,4);
  h+='<div class="stats'+(shown.length===4?' stats-2':(shown.length===2?' stats-2':''))+'" style="margin-top:12px">'+shown.join('')+'</div>';
  if(cells.length>4) h+='<div class="stats stats-2" style="margin-top:10px">'+cells.slice(4,6).join('')+'</div>';

  /* ---- Le récit ---- */
  h+='<div class="section-title">Ce qu’il s’est passé</div>'
   +'<div class="card"><div class="why" style="font-style:normal">'+weekStory(r)+'</div></div>';

  /* ---- Comparaison avec la semaine d'avant ---- */
  const prev=weekReport(addDayYMD(mon,-7));
  if(prev.pesees>=2||prev.delta!=null) h+=weekCompare(r,prev);

  h+='<div class="btn-row" style="margin-top:14px">'
   +'<button class="btn btn--ghost" data-act="go" data-route="/courbes">'+ic('chart')+'Courbes</button>'
   +'<button class="btn btn--ghost" data-act="go" data-route="/tableau">'+ic('table')+'Tableau</button></div>';
  return h+weekJump(mon,t);
}
/* Le raccourci « revenir à cette semaine », seulement quand on s'est éloigné. */
function weekJump(mon,t){
  if(mon===t) return '';
  return '<button class="btn btn--ghost btn--block" data-act="wk-today" style="margin-top:10px">'
   +ic('calendar')+'Revenir à cette semaine</button>';
}
/* Sept colonnes : le poids du jour, sa hauteur relative, et le jour de la semaine. */
function weekStrip(r){
  const vals=r.days.filter(d=>d.w!=null).map(d=>d.w);
  const mn=vals.length?Math.min.apply(null,vals):0, mx=vals.length?Math.max.apply(null,vals):1;
  const span=Math.max(0.4,mx-mn);
  const t=isoToday();
  return '<div class="wkstrip">'+r.days.map((d,i)=>{
    const has=d.w!=null;
    /* Plus lourd = plus haut. On garde une base de 18 % pour que le jour le plus
       léger reste une barre visible, et pas un trait écrasé au sol. */
    const hpct=has?(18+((d.w-mn)/span)*60):0;
    const cls=has?'on':(d.futur?'futur':(d.saute?'skip':'off'));
    return '<button class="wkday '+cls+(d.date===t?' today':'')+'" data-act="weigh-in" data-date="'+d.date+'"'
      +' aria-label="'+esc(capit(fmtDateLong(d.date)))+(has?' — '+nf(d.w,1)+' kg':' — pas de pesée')+'">'
      +'<span class="wkday-bar"'+(has?' style="height:'+r1(hpct)+'%"':'')+'></span>'
      +'<span class="wkday-v">'+(has?nf(d.w,1):(d.futur?'':'·'))+'</span>'
      +'<span class="wkday-d">'+JOURS_MIN[(i+1)%7]+'</span></button>';
  }).join('')+'</div>';
}
/* La phrase sous le grand chiffre. Explique avant de chiffrer. */
function weekVerdict(r){
  if(r.delta==null) return r.pesees<2?'Une seule pesée : pas encore de variation à lire.':'Pas assez de recul pour cette semaine.';
  const a=Math.abs(r.delta);
  if(r.enCours) return 'Semaine en cours — le bilan se stabilisera dimanche.';
  if(a<0.15) return 'Un poids stable. Sur sept jours, c’est un maintien, pas un blocage.';
  if(r.delta<0) return a>1.2?'Une grosse semaine. Une part est de l’eau : la suivante le dira.'
                           :'Tu es plus léger qu’en début de semaine.';
  return a>1.0?'La balance est montée. Sel, glucides, séance intense : ça se dégonfle en quelques jours.'
             :'Léger rebond. C’est dans la marge de bruit d’une semaine ordinaire.';
}
/* Le récit : trois à cinq phrases, en français, sans jugement. */
function weekStory(r){
  const P=[];
  const nb=r.pesees, jours=r.enCours?(diffDays(r.mon,r.last)+1):7;
  if(nb===jours) P.push('Tu t’es pesé <b>tous les jours</b> de la semaine.');
  else if(nb>=jours-1) P.push('Tu t’es pesé <b>'+nb+' '+plural(nb,'jour')+' sur '+jours+'</b> — c’est largement assez pour une tendance fiable.');
  else if(nb>=3) P.push('<b>'+nb+' '+plural(nb,'pesée')+'</b> cette semaine. La tendance tient, même avec des trous.');
  else P.push('<b>'+nb+' '+plural(nb,'pesée')+'</b> seulement : je lis la semaine, mais avec prudence.');

  if(r.ecart!=null&&r.ecart>=0.8)
    P.push('Entre ton jour le plus léger et le plus lourd, il y a <b>'+nf(r.ecart,1)+' kg</b>. '
      +'C’est presque toujours de l’eau : une journée salée, un repas tardif ou une grosse séance suffisent.');
  if(r.plusLeger&&nb>=3)
    P.push('Ton jour le plus léger : <b>'+esc(capit(parseYMD(r.plusLeger.date).toLocaleDateString('fr-FR',{weekday:'long'})))
      +'</b>, à '+fmtKg(r.plusLeger.w)+'.');

  if(r.kcalMoy!=null&&r.kcalJours>=3){
    const mk=(typeof maintenanceKcal==='function')?maintenanceKcal():null;
    const neutre=mk&&mk.kcal?mk.kcal:null;
    if(neutre){
      const ec=Math.round(r.kcalMoy-neutre);
      P.push('Tu as mangé <b>'+nf(r.kcalMoy,0)+' kcal par jour</b> en moyenne'
        +(Math.abs(ec)<80?', soit à peu près ton point neutre.'
         :(ec<0?', soit <b>'+nf(-ec,0)+' kcal sous</b> ton point neutre — environ '+fmtKg(Math.abs(ec)*7/KCAL_PER_KG_FAT)+' par semaine en théorie.'
               :', soit '+nf(ec,0)+' kcal au-dessus de ton point neutre.')));
    } else P.push('Tu as mangé <b>'+nf(r.kcalMoy,0)+' kcal par jour</b> en moyenne, sur '+r.kcalJours+' '+plural(r.kcalJours,'jour')+' noté'+(r.kcalJours>1?'s':'')+'.');
  }
  if(state.settings.modules.sport){
    if(r.sportN===0) P.push('Aucune séance notée. Une semaine sans sport ne casse rien — la régularité se juge sur le mois.');
    else P.push('<b>'+r.sportN+' '+plural(r.sportN,'séance')+'</b> pour '+fmtMin(r.sportMin)+' au total.');
  }
  if(r.pill&&r.pill.pct>=90) P.push('Pilulier tenu à <b>'+r.pill.pct+' %</b>.');
  return P.join(' ');
}
/* La comparaison : deux semaines côte à côte, sans classement. */
function weekCompare(r,prev){
  const rows=[['Pesées',r.pesees+'/7',prev.pesees+'/7']];
  if(r.delta!=null&&prev.delta!=null) rows.push(['Variation',sgnKg(r.delta),sgnKg(prev.delta)]);
  if(r.moy!=null&&prev.moy!=null) rows.push(['Poids moyen',fmtKg(r.moy),fmtKg(prev.moy)]);
  if(r.kcalMoy!=null&&prev.kcalMoy!=null) rows.push(['Calories/jour',nf(r.kcalMoy,0),nf(prev.kcalMoy,0)]);
  if(state.settings.modules.sport&&(r.sportMin||prev.sportMin)) rows.push(['Sport',fmtMin(r.sportMin),fmtMin(prev.sportMin)]);
  if(rows.length<2) return '';
  return '<div class="section-title">Face à la semaine d’avant</div><div class="card"><div class="wk-table">'
   +'<div class="wk-row wk-head"><span></span><span>'+(r.enCours?'En cours':'Cette semaine')+'</span><span>Précédente</span></div>'
   +rows.map(o=>'<div class="wk-row"><span class="wk-d">'+esc(o[0])+'</span><span>'+o[1]+'</span><span class="muted">'+o[2]+'</span></div>').join('')
   +'</div></div>';
}

/* ============================================================
   ÉCRAN : SIMULATEUR
   ------------------------------------------------------------
   « Comme un calcul de prêt » : on règle une mensualité (les
   calories du jour) et on voit la date de fin. Le métabolisme
   baissant avec le poids, la simulation est refaite jour par
   jour — une projection en ligne droite ment toujours un peu.
   ============================================================ */
function simIntake(){
  const m=maintenanceKcal();
  if(state.ui.simIntake==null){
    const obs=tdeeObserved();
    const base=(obs.ok&&obs.intake)?obs.intake:(m.kcal!=null?m.kcal-500:2000);
    state.ui.simIntake=clamp(Math.round(base/50)*50,800,6000);
  }
  return state.ui.simIntake;
}
function simTarget(){
  const t=state.ui.simTarget!=null?state.ui.simTarget:targetWeight();
  return t!=null?t:null;
}
/* « 31 oct. » ne veut rien dire quand l'année n'est pas l'année en cours. */
function fmtDateFar(d){
  if(!d) return '—';
  return d.slice(0,4)===isoToday().slice(0,4)?fmtDateShort(d)
    :capit(parseYMD(d).toLocaleDateString('fr-FR',{month:'short',year:'numeric'}));
}
function screenSimulateur(){
  let h=backHead('Simulateur','/analyse');
  const w=refWeight().kg, m=maintenanceKcal();
  if(w==null||!state.settings.profile.heightCm)
    return h+empty('calculator','Il me manque deux chiffres','Ta taille et une pesée suffisent pour lancer la simulation.',
      '<button class="btn btn--primary" data-act="go" data-route="/reglages">Compléter mon profil</button>');
  if(m.kcal==null)
    return h+empty('calculator','Point neutre indisponible','Renseigne ta taille et ton année de naissance dans les réglages.',
      '<button class="btn btn--primary" data-act="go" data-route="/reglages">Aller aux réglages</button>');

  const intake=simIntake(), tg=simTarget();
  const sim=simulate(intake,{targetKg:tg});
  const neutral=sim.ok?sim.tdee0:m.kcal;
  const gap=intake-neutral;

  /* Le point neutre : la vraie information de cet écran. */
  h+='<div class="card card--accent"><div class="stat-label">Ton point neutre</div>'
   +'<div class="hero-value tnum" style="font-size:38px;margin:2px 0 0"><span data-count="'+neutral+'" data-dec="0">'+nf(neutral,0)+'</span><span class="hero-unit">kcal/j</span></div>'
   +'<div class="small muted" style="margin-top:6px">À ce niveau, ton poids ne bouge plus. '
   +esc(m.source==='observé'?'Mesuré sur toi : '+m.why+'.':'Estimé : '+m.why+'. Note tes calories pendant trois semaines et ce chiffre deviendra le tien.')+'</div>'
   +(m.source==='observé'?'<div class="badge badge--ok" style="margin-top:8px">calculé sur tes données</div>':'')
   +'</div>';

  /* Le curseur : ce qu'on mange chaque jour. */
  h+='<div class="card" style="margin-top:12px">'
   +'<div class="flex between aic"><div class="row-title">Ce que je mange par jour</div>'
   +'<div class="tnum" style="font-size:22px;font-weight:700"><span id="simVal">'+nf(intake,0)+'</span><span class="muted small"> kcal</span></div></div>'
   +'<div class="stepper" style="margin-top:10px">'
   +'<button class="step-btn" data-act="sim-delta" data-d="-100">−100</button>'
   +'<input class="range" type="range" id="simRange" min="1000" max="'+Math.max(4000,neutral+800)+'" step="25" value="'+intake+'" data-neutral="'+neutral+'" aria-label="Calories par jour">'
   +'<button class="step-btn" data-act="sim-delta" data-d="100">+100</button></div>'
   +'<div class="chip-wrap" style="margin-top:10px">'
   +[['Maintien',0],['Doux −250',-250],['Classique −500',-500],['Rapide −750',-750]].map(o=>{
      const v=clamp(Math.round((neutral+o[1])/25)*25,800,6000);
      return '<button class="chip'+(Math.abs(v-intake)<13?' is-active':'')+'" data-act="sim-set" data-v="'+v+'">'+esc(o[0])+'</button>'; }).join('')
   +'</div>'
   +'<div class="sim-gap '+(gap<0?'is-down':(gap>0?'is-up':''))+'" id="simGap">'
   +(Math.abs(gap)<25?'Tu es à l’équilibre : ton poids reste stable.'
     :(gap<0?'<b>'+nf(-gap,0)+' kcal</b> de moins que ton point neutre chaque jour.'
            :'<b>'+nf(gap,0)+' kcal</b> de plus que ton point neutre chaque jour.'))+'</div>'
   +'</div>';

  if(sim.ok){
    const perWeek=sim.kgWeek, perMonth=perWeek*4.345;
    h+='<div class="stats stats-2" style="margin-top:12px">'
     +statCard('Par semaine',sgnKg(perWeek),Math.abs(perWeek)>0.005?rateWord(perWeek):'stable',deltaClass(perWeek,-1))
     +statCard('Par mois',sgnKg(perMonth),'',deltaClass(perMonth,-1))
     +statCard('Dans 3 mois',fmtKg(sim.w90),(sim.etaDays!=null&&sim.etaDays<=90)?'objectif atteint':fmtDateShort(addDayYMD(isoToday(),90)),'')
     +statCard('Dans 1 an',fmtKg(sim.w365),(sim.etaDays!=null&&sim.etaDays<=365)?'objectif atteint':fmtDateShort(addDayYMD(isoToday(),365)),'')
     +'</div>';

    /* La courbe de projection : le vrai « tableau d'amortissement ». */
    const pts=sim.series.filter(p=>p.date<=addDayYMD(isoToday(),Math.min(1100,(sim.etaDays!=null?sim.etaDays+20:400))));
    const past=trendSeries().filter(x=>x.date>=addDayYMD(isoToday(),-60)).map(x=>({date:x.date,v:x.trend}));
    h+='<div class="chart-card" style="margin-top:12px"><div class="chart-title">Ta trajectoire à ce rythme</div>'
     +chartSlot(w2=>lineChart([
        {key:'passe',label:'Jusqu’ici',color:'var(--m-poids)',unit:'kg',dec:1,points:past},
        {key:'proj',label:'Projection',color:'var(--acc)',unit:'kg',dec:1,points:pts,dash:'5 4',dots:false}],
        {w:w2,h:CH_H,from:past.length?past[0].date:isoToday(),to:pts[pts.length-1].date,id:'sim',scrub:false,
         goal:tg!=null?{v:tg,label:'Objectif '+nf(tg,1)+NBSP+'kg'}:null,yUnit:'kg'}),{h:CH_H})
     +'<div class="chart-legend"><span class="legend-item" style="color:var(--m-poids)"><i></i>ta tendance</span>'
     +'<span class="legend-item" style="color:var(--acc)"><i class="dash"></i>projection</span></div></div>';

    if(tg!=null){
      h+='<div class="card card--accent" style="margin-top:12px"><div class="stat-label">Objectif '+fmtKg(tg)+'</div>';
      if(sim.etaDays!=null)
        h+='<div class="row-title" style="font-size:19px;margin-top:2px">'+esc(capit(fmtDateLong(sim.etaDate)))+'</div>'
         +'<div class="small muted" style="margin-top:4px">dans '+esc(humanDuration(sim.etaDays))+' · '
         +fmtKg(Math.abs(w-tg))+' à faire</div>';
      else if(Math.abs(gap)<25) h+='<div class="small muted">À l’équilibre, tu n’avances ni ne recules. Baisse un peu la barre pour voir une date apparaître.</div>';
      else if(gap>0) h+='<div class="small muted">À ce niveau, tu prends du poids : l’objectif s’éloigne au lieu de se rapprocher.</div>';
      else h+='<div class="small muted">Plus de cinq ans à ce rythme — autant dire que le poids se stabilisera avant. Creuse un peu l’écart pour voir une date apparaître.</div>';
      h+='<button class="btn-add" data-act="edit-goal" style="margin-top:8px">Changer d’objectif</button></div>';
    } else {
      h+='<div class="card" style="margin-top:12px"><div class="small muted">Fixe-toi un objectif pour voir une date d’arrivée apparaître ici.</div>'
       +'<button class="btn btn--primary btn--block" data-act="edit-goal" style="margin-top:10px">Choisir mon objectif</button></div>';
    }

    /* Le garde-fou : au-delà de 1 % du poids par semaine, la part de muscle perdue monte. */
    const pctW=Math.abs(perWeek)/Math.max(1,w)*100;
    if(perWeek<0&&pctW>1.05)
      h+='<div class="insight insight--neutral" style="margin-top:12px"><div class="insight-ic">'+ic('gauge')+'</div><div class="insight-txt">'
       +'À ce niveau tu perdrais <strong>'+nf(pctW,1)+' % de ton poids par semaine</strong>. Au-delà de 1 %, la part de masse maigre perdue augmente mécaniquement, et la faim devient difficile à tenir. '
       +'Pour toi, la zone confortable va de '+fmtKg(w*0.005)+' à '+fmtKg(w*0.01)+' par semaine.'
       +'</div></div>';
    else if(perWeek<0&&pctW>=0.4)
      h+='<div class="insight" style="margin-top:12px"><div class="insight-ic">'+ic('check')+'</div><div class="insight-txt">'
       +'<strong>'+nf(pctW,2)+' % de ton poids par semaine</strong> : c’est exactement la zone qui se tient sur la durée.'
       +'</div></div>';

    /* Le « tableau d'amortissement » : trois scénarios côte à côte. */
    h+='<div class="section-title">Et si je changeais ?</div><div class="card"><div class="sim-table">'
     +'<div class="sim-row sim-head"><span>kcal/jour</span><span>par semaine</span><span>'+(tg!=null?'objectif':'dans 6 mois')+'</span></div>'
     +[-750,-500,-350,-250,0,250].map(dv=>{
        const v=clamp(Math.round((neutral+dv)/25)*25,800,6000);
        const s2=simulate(v,{targetKg:tg});
        if(!s2.ok) return '';
        const right=tg!=null?(s2.etaDays!=null?fmtDateFar(s2.etaDate):'jamais'):fmtKg(s2.w180);
        return '<div class="sim-row'+(Math.abs(v-intake)<13?' is-cur':'')+'" data-act="sim-set" data-v="'+v+'">'
         +'<span class="tnum"><b>'+nf(v,0)+'</b></span>'
         +'<span class="tnum '+deltaClass(s2.kgWeek,-1)+'">'+sgnKg(s2.kgWeek)+'</span>'
         +'<span class="tnum muted">'+esc(right)+'</span></div>'; }).join('')
     +'</div><div class="hint" style="margin-top:10px">Touche une ligne pour l’essayer.</div></div>';
  }

  h+='<div class="card" style="margin-top:12px"><div class="row-title flex aic gap8">'+ic('bricks','ic--sm')+'Le seul chiffre à retenir</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">Un kilo de graisse, c’est environ <b>7 700 kcal</b>. Pour en perdre un par semaine, il faut donc creuser à peu près <b>1 100 kcal par jour</b> — c’est beaucoup. '
   +'À <b>−500 kcal par jour</b>, tu perds environ <b>0,45 kg par semaine</b>, soit près de 2 kg par mois. C’est le rythme que la plupart des gens tiennent sur la durée.</div></div>';
  h+='<div class="hint" style="margin-top:12px">Une projection n’est pas une promesse : l’eau, le sel et le glycogène font zigzaguer la balance autour de cette ligne. C’est la direction qui compte.</div>';
  return h;
}

/* ============================================================
   ÉCRAN : BOÎTE À OUTILS
   ------------------------------------------------------------
   L'écran Aide explique l'application. Celui-ci explique le
   sujet : ce qui fait bouger une balance, ce qui n'en fait pas,
   et quoi faire quand plus rien ne bouge. Chaque repère est
   chiffré AVEC les données de l'utilisateur quand c'est possible
   — un conseil générique se lit une fois, un conseil qui parle
   de tes 109 kg se relit. Aucun conseil médical, aucune calorie
   prescrite : on décrit, on n'ordonne pas.
   ============================================================ */
function tipCard(o){
  return '<details class="acc"'+(o.open?' open':'')+'>'
   +'<summary class="acc-sum"><span class="acc-ic">'+ic(o.icon)+'</span>'
   +'<span class="acc-t"><b>'+esc(o.title)+'</b>'+(o.badge?'<span class="acc-b">'+esc(o.badge)+'</span>':'')+'</span>'
   +'<span class="acc-ch" aria-hidden="true"></span></summary>'
   +'<div class="acc-body">'+o.body+'</div></details>';
}
function screenAstuces(){
  let h=backHead('Boîte à outils','/plus');
  h+='<div class="hint" style="margin-bottom:12px">Des repères simples, classés selon là où tu en es. Touche un titre pour le déplier. Rien ici n’est une prescription — juste ce qu’on sait de la façon dont un corps réagit.</div>';
  const T=[];
  const ref=refWeight().kg, rate=bestRate(), pl=detectPlateau(), sg=noiseSigma();
  const pctWeek=(rate!=null&&ref)?100*(-rate)/ref:null;
  const weeks=Math.floor((sinceStartDays()||0)/7);

  /* 1. Le palier, en tête quand il est là : c'est le moment où on abandonne. */
  if(pl.isPlateau){
    T.push({p:100,icon:'layers',title:'Ton poids fait une pause',badge:pl.sinceDays+' jours',open:true,body:
      '<p>Un palier n’est pas un arrêt de la perte de graisse : c’est presque toujours de l’eau qui prend la place. '
      +'Le corps garde plus d’eau quand le stress monte, quand on mange plus salé, ou quand un muscle a travaillé dur.</p>'
      +'<p><b>Quatre choses à regarder, dans cet ordre :</b></p>'
      +'<ol class="tip-ol"><li>Tes <b>portions réelles</b>. Les quantités estimées dérivent avec le temps, sans qu’on s’en rende compte. Repeser ce qu’on mange pendant trois jours suffit souvent à tout expliquer.</li>'
      +'<li>Ton <b>tour de taille</b>. Il continue souvent de baisser quand la balance ne bouge plus. C’est la meilleure preuve que ça avance.</li>'
      +'<li>Tes <b>pas</b>. Quand on mange moins, on bouge spontanément moins. C’est automatique et invisible.</li>'
      +'<li>Le <b>temps</b>. Dix à quatorze jours de plateau, c’est banal. Ne change rien avant.</li></ol>'
      +'<p class="tip-note">Ton bruit naturel est de ±'+fmtKg(sg.sigma)+' d’un jour à l’autre : en dessous, il ne se passe rien de réel.</p>'
      +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/courbes" style="margin-top:10px">Voir ma courbe</button>'});
  }
  /* 2. Protéines : le seul levier alimentaire vraiment déterminant en déficit. */
  const pt=proteinTarget(), ps=proteinStats(14);
  if(pt) T.push({p:95,icon:'meat',title:'Tes protéines',badge:'≈ '+pt.g+' g/jour',open:!pl.isPlateau,body:
    '<p>En déficit, le corps pioche dans la graisse <i>et</i> dans le muscle. Manger assez de protéines est ce qui déplace le curseur vers la graisse. '
    +'C’est aussi ce qui cale le mieux : à calories égales, un repas riche en protéines tient plus longtemps.</p>'
    +'<p>Pour toi, cela représente environ <b>'+pt.g+' g par jour</b> (1,6 g par kilo de poids de forme, estimé à '+pt.basisKg+' kg). '
    +'Yazio affiche ce chiffre : tu peux le noter ici chaque soir avec tes calories.</p>'
    +(ps.ok?'<p class="tip-note">Sur tes '+ps.n+' derniers jours renseignés : <b>'+ps.mean+' g</b> en moyenne, soit '+ps.pct+' % de la cible. '
       +(ps.mean>=pt.g*0.9?'C’est bien.':'Il y a de la marge — un yaourt grec, un œuf ou 100 g de blanc de poulet valent chacun 15 à 25 g.')+'</p>'
     :'<p class="tip-note">Tu ne notes pas encore tes protéines. C’est la mesure la plus utile après les calories.</p>'
      +'<button class="btn btn--ghost btn--block" data-act="metric-on" data-k="protIn" style="margin-top:10px">Suivre mes protéines</button>')
    +'<p class="tip-note">Repères : 100 g de poulet ≈ 23 g · un œuf ≈ 6 g · un yaourt grec ≈ 10 g · 100 g de thon ≈ 25 g · une dose de whey ≈ 20 à 25 g.</p>'});
  /* 3. Le rythme. */
  T.push({p:90,icon:'gauge',title:'À quelle vitesse perdre',badge:pctWeek!=null?nf(pctWeek,1)+' %/sem.':null,body:
    '<p>La fourchette qui tient sur la durée va de <b>0,5 à 1 % de ton poids par semaine</b>. '
    +(ref?'Pour toi aujourd’hui, cela fait <b>'+fmtKg(ref*0.005)+' à '+fmtKg(ref*0.01)+' par semaine</b>.':'')+'</p>'
    +'<p>Plus vite, ce n’est pas « mieux » : la part de muscle perdue augmente, la faim aussi, et le rebond guette. Plus lentement, c’est parfaitement valable — c’est même souvent ce qui reste.</p>'
    +(pctWeek!=null?'<p class="tip-note">Ton rythme actuel : <b>'+nf(pctWeek,2)+' % par semaine</b>. '
       +(pctWeek>1.2?'C’est rapide. Si tu as faim en permanence, remonte un peu ton assiette : tu perdras presque autant, en te sentant mieux.'
        :(pctWeek<0.15?'C’est lent en ce moment. Ce n’est pas grave si ça te convient — la régularité bat la vitesse.'
        :'Tu es exactement dans la bonne zone.'))+'</p>':'')
    +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/simulateur" style="margin-top:10px">'+ic('calculator')+'Essayer un autre rythme</button>'});
  /* 4. Peser juste. */
  T.push({p:85,icon:'scale',title:'Peser dans les mêmes conditions',body:
    '<p>Une balance ne se trompe pas beaucoup, mais elle mesure tout : l’eau, le contenu de l’intestin, le sel de la veille. '
    +'Pour que deux pesées soient comparables, il faut qu’elles se ressemblent.</p>'
    +'<ul class="tip-ul"><li>Au réveil, après être passé aux toilettes, avant de boire ou de manger.</li>'
    +'<li>Sans vêtements, ou toujours les mêmes.</li>'
    +'<li>Sur un <b>sol dur</b> — un tapis fausse la mesure, parfois de plus d’un kilo.</li>'
    +'<li>Toujours la même balance, au même endroit de la pièce.</li>'
    +'<li>Pieds secs et propres : l’impédance passe par la peau.</li></ul>'
    +'<p class="tip-note">Les mesures de composition (gras, eau, muscle) sont bien plus sensibles que le poids : à lire uniquement en tendance sur deux ou trois semaines.</p>'});
  /* 5. Le sel, l'eau, le lendemain de fête. */
  T.push({p:80,icon:'plate',title:'Le lendemain d’un gros repas',body:
    '<p>Le matin après un restaurant ou un repas de famille, la balance monte souvent de <b>1 à 2 kg</b>. '
    +'Ce ne sont pas des kilos de graisse : il faudrait manger 7 700 kcal en trop pour fabriquer un seul kilo de gras.</p>'
    +'<p>Ce que tu vois, c’est du sel et des glucides qui retiennent de l’eau, plus le poids de ce qui n’est pas encore digéré. '
    +'Ça s’en va tout seul en <b>deux à quatre jours</b>, surtout si tu bois normalement et que tu bouges un peu.</p>'
    +'<p class="tip-note">Le réflexe utile : continuer à se peser. Sauter la pesée « parce que ça va être moche », c’est perdre l’information qui montre justement que ça redescend.</p>'});
  /* 6. Bouger hors sport — le plus gros levier après l'assiette. */
  T.push({p:75,icon:'steps',title:'Ce que tu brûles sans t’en rendre compte',body:
    '<p>Entre deux personnes de même poids, l’écart de dépense quotidienne lié aux gestes ordinaires — marcher, monter un escalier, rester debout — peut atteindre <b>plusieurs centaines de calories</b>. '
    +'C’est plus que trois séances de sport dans la semaine.</p>'
    +'<p>Le piège : quand on mange moins, on bouge spontanément moins, sans le décider. C’est l’une des causes les plus fréquentes de palier.</p>'
    +'<ul class="tip-ul"><li>Un arrêt de bus plus tôt, c’est déjà 10 à 15 minutes.</li>'
    +'<li>Un appel téléphonique debout ou en marchant.</li>'
    +'<li>Une marche de 10 minutes après le repas : elle aide aussi la digestion et la glycémie.</li></ul>'
    +(metricOn('steps')?'':'<button class="btn btn--ghost btn--block" data-act="metric-on" data-k="steps" style="margin-top:10px">Suivre mes pas</button>')});
  /* 7. Muscu en déficit. */
  if(state.settings.modules.sport) T.push({p:70,icon:'dumbbell',title:'Pourquoi soulever quelque chose',body:
    '<p>Le sport d’endurance brûle des calories pendant la séance. Le travail en force, lui, envoie un signal différent : « garde ce muscle, il sert ». '
    +'En déficit, c’est ce signal qui détermine si les kilos perdus viennent surtout du gras.</p>'
    +'<p>Deux à trois séances par semaine suffisent largement. Les mouvements qui font travailler beaucoup de muscles à la fois (squat, tirage, pompes, fentes) rapportent le plus par minute passée.</p>'
    +'<p class="tip-note">Effet secondaire connu : un muscle qui vient de travailler retient de l’eau pendant deux à trois jours. La balance monte alors que tout va bien.</p>'});
  /* 8. Sommeil. */
  T.push({p:65,icon:'moon',title:'Le sommeil pèse sur la balance',body:
    '<p>Quand on dort peu, l’appétit augmente le lendemain — en particulier pour le sucré et le gras — et la volonté baisse. '
    +'Ce n’est pas un manque de caractère : c’est de la chimie.</p>'
    +'<p>À déficit identique, mieux dormir change la proportion de graisse dans ce que tu perds. C’est le levier le moins coûteux de tous.</p>'
    +(metricOn('sleep')?'<p class="tip-note">Tu notes déjà ton sommeil : dans quelques semaines, la courbe dira si tes nuits courtes se voient sur ta balance.</p>'
      :'<button class="btn btn--ghost btn--block" data-act="metric-on" data-k="sleep" style="margin-top:10px">Suivre mon sommeil</button>')});
  /* 9. Tour de taille. */
  T.push({p:60,icon:'ruler',title:'Le mètre ruban dit ce que la balance cache',body:
    '<p>Le tour de taille descend souvent quand le poids stagne : la graisse part pendant que l’eau et le muscle compensent sur la balance. '
    +'C’est aussi un meilleur indicateur de santé que l’IMC, parce qu’il vise la graisse du ventre.</p>'
    +'<ul class="tip-ul"><li>Au niveau du nombril, debout, à jeun, sans serrer.</li>'
    +'<li>Une fois par mois suffit — c’est trop lent pour être suivi chaque semaine.</li>'
    +'<li>Toujours au même moment de la journée.</li></ul>'
    +(metricOn('waist')?'<button class="btn btn--ghost btn--block" data-act="weigh-in" style="margin-top:10px">Noter mon tour de taille</button>'
      :'<button class="btn btn--ghost btn--block" data-act="metric-on" data-k="waist" style="margin-top:10px">Suivre mon tour de taille</button>')});
  /* 10. Pause de régime, proposée seulement quand elle a du sens. */
  if(weeks>=10) T.push({p:78,icon:'clock',title:'Et si tu faisais une pause ?',badge:weeks+' semaines',body:
    '<p>Après deux à trois mois de déficit continu, une <b>semaine à ton point neutre</b> — ni plus, ni moins — fait souvent plus de bien qu’un effort supplémentaire : la faim redescend, l’énergie revient, et la perte repart ensuite plus franchement.</p>'
    +'<p>Ce n’est pas un abandon, c’est une respiration prévue. Tu continues à te peser, tu continues à noter : tu changes seulement la hauteur de la barre pendant sept jours.</p>'
    +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/simulateur" style="margin-top:10px">Voir mon point neutre</button>'});
  /* 11. Alcool, factuel. */
  T.push({p:50,icon:'droplet',title:'L’alcool, sans morale',body:
    '<p>Un gramme d’alcool apporte 7 kcal — presque autant que le gras. Un verre de vin tourne autour de 120 kcal, une pinte autour de 200.</p>'
    +'<p>Mais l’essentiel est ailleurs : tant qu’il y a de l’alcool à traiter, le corps met le reste en attente. Et il désinhibe l’appétit — c’est souvent ce qui accompagne le verre qui compte le plus.</p>'
    +'<p class="tip-note">Aucune raison de s’en priver si tu y tiens. Le noter dans tes calories suffit à ce que l’app reste juste.</p>'});
  /* 12. L'effet week-end, personnalisé. */
  const wd=weekdayEffect();
  if(wd.ok&&wd.notable) T.push({p:72,icon:'calendar',title:'Ton effet week-end',badge:capit(wd.hi.label),body:
    '<p>Ton poids du '+esc(wd.hi.label)+' est en moyenne <b>'+fmtKg(wd.gap)+'</b> au-dessus de ton '+esc(wd.lo.label)+'. '
    +'C’est le rythme de ta semaine, pas de la graisse qui apparaît et disparaît.</p>'
    +'<p>Le piège classique : comparer un lundi à un vendredi et croire qu’on a tout perdu ou tout repris. '
    +'Compare toujours un lundi à un lundi — ou fie-toi à la tendance lissée, qui fait ça pour toi.</p>'
    +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/analyse" style="margin-top:10px">Voir ma semaine</button>'});
  /* 13. Le redémarrage. */
  T.push({p:40,icon:'sprout',title:'Reprendre après une coupure',body:
    '<p>Une semaine sans se peser, un mois sans noter : ça arrive à tout le monde et ça n’efface rien. '
    +'Tes anciennes données sont toujours là, ta tendance se recalcule toute seule, ta série repart de zéro sans que ça change quoi que ce soit à ton corps.</p>'
    +'<p>La seule chose qui compte : la pesée de demain matin. Pas celles qui manquent.</p>'});

  T.sort((a,b)=>b.p-a.p);
  h+=T.map(tipCard).join('');
  h+='<div class="hint" style="margin-top:14px">Élan décrit des mécanismes généraux et tes propres chiffres. Pour toute question de santé, de traitement ou de régime particulier, c’est à un professionnel qu’il faut demander.</div>';
  return h;
}

function analyseProteines(){
  const t=proteinTarget(); if(!t) return '';
  const ps=proteinStats(14);
  let h='<div class="section-title">Tes protéines</div><div class="card">';
  if(ps.ok){
    const ratio=clamp(ps.mean/t.g,0,1.3);
    h+='<div class="flex between aic"><div><div class="stat-label">Moyenne sur '+ps.n+' '+plural(ps.n,'jour')+'</div>'
     +'<div class="hero-value tnum" style="font-size:30px;margin:2px 0 0"><span data-count="'+ps.mean+'" data-dec="0">'+nf(ps.mean,0)+'</span><span class="hero-unit">g/j</span></div></div>'
     +'<div class="stat-label" style="text-align:right">cible<br><b style="font-size:17px;color:var(--tx-1)">'+t.g+' g</b></div></div>'
     +'<div class="bar" style="margin-top:12px"><span class="bar-seg" data-bar="'+Math.min(1,ratio).toFixed(2)+'" style="background:var(--grad-brand)"></span></div>'
     +'<div class="small muted" style="margin-top:10px;line-height:1.5">'
     +(ps.mean>=t.g*0.9
        ?'Tu es à la cible. C’est ce qui fait que les kilos perdus viennent surtout de la graisse, et pas du muscle.'
        :'Il te manque environ <b>'+nf(t.g-ps.mean,0)+' g par jour</b> pour atteindre la cible. En déficit, c’est le seul macro qui change vraiment la nature de ce que tu perds.')
     +'</div>';
  } else {
    h+='<div class="row-title">≈ '+t.g+' g par jour</div>'
     +'<div class="small muted" style="margin:6px 0 0;line-height:1.5">C’est la quantité qui, en déficit, protège le mieux ton muscle — 1,6 g par kilo de poids de forme (estimé à '+t.basisKg+' kg chez toi). '
     +'Yazio te donne déjà ce chiffre chaque soir&nbsp;: tu peux le noter ici à côté de tes calories.</div>'
     +'<button class="btn btn--ghost btn--block" data-act="metric-on" data-k="protIn" style="margin-top:12px">Suivre mes protéines</button>';
  }
  h+='<div class="hint" style="margin-top:10px">Repère, pas prescription : si tu as un souci de reins ou un régime particulier, c’est à ton médecin d’en décider.</div>';
  return h+'</div>';
}

/* ---------- Écran : Calories ---------- */
function screenCalories(){
  if(!state.settings.modules.kcalIn){
    return backHead('Calories','/plus')
      +'<div class="card"><div class="row-title flex aic gap8">'+ic('plate','ic--sm')+'Calories mangées</div>'
      +'<div class="small muted" style="margin:6px 0 12px">Note chaque jour ce que tu as mangé (le total de Yazio suffit). Élan cherche alors le décalage réel entre ton alimentation et ta balance, et calcule ta dépense réelle.</div>'
      +'<button class="btn btn--primary btn--block" data-act="mod-on" data-k="kcalIn">Activer les calories</button></div>';
  }
  const S=seriesOf(PICK_KIN);
  const w7=windowOf(S,isoToday(),7), w30=windowOf(S,isoToday(),30);
  const eb=energyBalance(), obs=tdeeObserved();
  let h=backHead('Calories','/plus','<button class="btn-add" data-act="quick-kcal">+ Noter</button>');
  h+='<div class="stats" style="margin-top:12px">'
   +statCard('Moyenne 7 j',w7.length?nf(meanOf(w7.map(p=>p.v)),0):'—',w7.length+' '+plural(w7.length,'jour'),'')
   +statCard('Moyenne 30 j',w30.length?nf(meanOf(w30.map(p=>p.v)),0):'—',w30.length+' '+plural(w30.length,'jour'),'')
   +statCard('Dépense réelle',obs.ok?nf(obs.kcal,0):'—',obs.ok?'observée':'à venir','')
   +'</div>';
  if(eb.ok){
    h+='<div class="card" style="margin-top:12px"><div class="row-title">Déficit et réalité</div>'
     +'<div class="stats stats-2" style="margin-top:10px">'
     +statCard('Déficit estimé',nf(eb.deficit,0)+' kcal','par jour','')
     +statCard('Perte prévue',fmtKg(-eb.expectedKgWeek),'par semaine','')
     +statCard('Perte réelle',fmtKg(-eb.actualKgWeek),'par semaine','')
     +statCard('Écart',eb.ratio!=null?Math.round(eb.ratio*100)+' %':'—','du prévu','')
     +'</div>';
    if(eb.ratio!=null){
      let t;
      if(eb.ratio>=0.8&&eb.ratio<=1.25) t='Ton déficit prévoyait '+fmtKg(-eb.expectedKgWeek)+'/semaine, tu perds '+fmtKg(-eb.actualKgWeek)+'/semaine : ça colle. Tes chiffres sont fiables.';
      else if(eb.ratio>1.25) t='Tu perds plus vite que ce que ton déficit prévoit. Souvent de l’eau et du glycogène en début de période — ça se stabilisera.';
      else if(eb.ratio>=0.4) t='Tu perds moins vite que le calcul ('+Math.round(eb.ratio*100)+' % du prévu). Les trois causes les plus fréquentes : des calories non comptées, une dépense réelle plus basse que l’estimation, ou de l’eau qui masque la perte.';
      else t='Gros écart entre le calcul et la réalité. Le plus souvent, ce sont les portions estimées.';
      h+='<div class="small muted" style="margin-top:10px;line-height:1.5">'+esc(t)+'</div>';
    }
    h+='</div>';
  }
  h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/courbes" style="margin-top:12px">'+ic('chart')+'Voir le décalage sur la courbe</button>';
  const days=[]; for(let i=13;i>=0;i--){ const d=addDayYMD(isoToday(),-i); days.push({d:d,v:mv(entryFor(d),'kcalIn')}); }
  const neutral=maintenanceKcal();
  h+='<div class="section-title">14 derniers jours</div><div class="list">'
   +days.slice().reverse().map(x=>{
     const w=mv(entryFor(x.d),'weight');
     const ec=(x.v!=null&&neutral.kcal!=null)?x.v-neutral.kcal:null;
     return '<div class="row" data-act="wi-kcal" data-date="'+x.d+'">'
     +'<div class="row-ic"'+(x.v==null?' style="color:var(--tx-3)"':' style="color:var(--m-cal)"')+'>'+ic('plate')+'</div>'
     +'<div class="row-main"><div class="row-title">'+esc(capit(fmtDayLabel(x.d)))+'</div>'
     +'<div class="row-sub">'+(x.v==null?'<span class="muted">non renseigné · toucher pour ajouter</span>'
        :('<b>'+nf(x.v,0)+' kcal</b>'+(ec!=null?' <span class="'+(ec<0?'down':'')+'">'+(ec<0?MINUS:'+')+nf(Math.abs(ec),0)+' vs neutre</span>':'')))
     +(w!=null?'<span class="pill">'+nf(w,1)+' kg</span>':'')+'</div></div>'+arrowHTML()+'</div>'; }).join('')
   +'</div>';
  h+='<div class="hint" style="margin:10px 4px 0">Toucher un jour ouvre sa pesée, curseur déjà dans la case des calories.</div>';
  return h;
}

/* Saisie éclair d'une seule métrique : le soir, noter ses calories ne doit pas
   demander de dérouler toute la feuille de pesée. */
function openQuickMetric(k,date){
  date=validYMD(date)?date:isoToday();
  const M=METRICS[k]; if(!M) return;
  const e=entryFor(date), cur=e?mv(e,k):null;
  openSheet(M.label+' — '+capit(fmtDayLabel(date)),
    '<div class="field"><label>'+esc(M.label)+(M.unit?' ('+esc(M.unit)+')':'')+'</label>'
    +'<input class="input tnum" id="qmVal" inputmode="decimal" autocomplete="off" value="'+(cur!=null?nf(cur,M.dec):'')+'" placeholder="—"></div>'
    +'<div class="chip-row">'+[[0,"Aujourd'hui"],[-1,'Hier'],[-2,'Avant-hier']].map(o=>{
        const d=addDayYMD(isoToday(),o[0]);
        return '<button class="chip'+(date===d?' is-active':'')+'" data-act="qm-day" data-k="'+k+'" data-date="'+d+'">'+esc(o[1])+'</button>'; }).join('')+'</div>'
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block btn--lg" data-act="qm-save" data-k="'+k+'" data-date="'+date+'">Enregistrer</button>'
    +'<button class="btn-add" data-act="weigh-in" data-date="'+date+'" style="margin-top:6px">Saisir toute la pesée ›</button></div>',
    {onOpen:()=>{ const el=document.getElementById('qmVal'); if(el) try{ el.focus(); }catch(x){} }});
}
function saveQuickMetric(k,date){
  const el=document.getElementById('qmVal');
  const v=parseNum(el?el.value:null);
  const e=ensureEntry(date);
  setMetric(e,k,v,METRICS[k].unit||defaultUnitOf(k));
  const vide=entryIsEmpty(e);
  if(vide) deleteEntry(date);
  closeSheet(); update();
  toast(v==null?'Valeur effacée':(METRICS[k].label+' enregistré ✓'));
}

/* ---------- Écran : Mes mesures ---------- */
function screenMetrics(){
  let h=backHead('Mes mesures','/plus');
  if(WI_RETOUR) h+='<div class="card card--accent"><div class="row-title flex aic gap8">'+ic('scale','ic--sm')+'Ta pesée t’attend</div>'
    +'<div class="small muted" style="margin:5px 0 10px">Ce que tu avais tapé est enregistré. Coche ce que tu veux saisir, puis reviens-y.</div>'
    +'<button class="btn btn--primary btn--block" data-act="wi-resume">Reprendre la pesée du '+esc(fmtDateShort(WI_RETOUR))+'</button></div>';
  h+='<div class="hint" style="margin-bottom:12px">Choisis ce que tu saisis chaque matin. Décoche ce que ta balance ne donne pas — tu pourras réactiver quand tu veux, sans rien perdre.</div>';
  const groups=[['Balance',['weight','fat','water','muscle','bone','protein','kcalOut','visceral','bmr','metaAge']],
    ['Mesures au mètre',['waist','hips','chest','arm','thigh','neck']],
    ['Habitudes',['protIn','steps','sleep','mood']]];
  groups.forEach(g=>{
    h+='<div class="section-title">'+esc(g[0])+'</div><div class="card">';
    g[1].forEach(k=>{
      const M=METRICS[k];
      if(M.always){ h+='<div class="toggle"><div class="grow"><div class="toggle-label">'+esc(M.label)+'</div>'
        +'<div class="toggle-sub">toujours actif</div></div><span class="badge badge--ok">requis</span></div>'; return; }
      h+=toggleHTML(esc(M.label),metricOn(k),'metric-toggle',' data-k="'+k+'"',
        (M.kind==='comp')?'saisissable en % ou en kg':(M.unit?('en '+M.unit):''));
    });
    h+='</div>';
  });
  h+='<div class="section-title">Le cas de l’« os »</div><div class="card">'
   +'<div class="small muted">Ta balance affiche une valeur autour de 12,7 pour les os. Ce n’est ni des kilos de squelette (2,5 à 4 kg chez un adulte) ni un pourcentage habituel : c’est probablement un indice propre à ta balance. Élan l’enregistre tel quel et te montre seulement s’il bouge.</div>'
   +'<div class="field" style="margin-top:12px"><label>L’unité affichée pour l’os</label>'
   +segHTML([['kg','kg'],['pct','%']],state.settings.metricUnitPref.bone||'kg','bone-unit','')+'</div>'
   +'<div class="hint">Changer cette unité ne réécrit jamais ton historique : seule l’étiquette change.</div></div>';
  return h;
}

/* ---------- Écran : Aide ---------- */
function screenAide(){
  return backHead('Aide','/plus')
   +'<div class="card"><div class="row-title flex aic gap8">'+ic('scale','ic--sm')+'Pourquoi le % et les kg ?</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">Une balance à impédance donne des pourcentages. Mais un pourcentage est un rapport : si ton poids baisse, ton % de gras peut baisser sans que tu aies perdu un seul gramme de graisse. Élan convertit tout en kilos à partir du poids du jour — et affiche les deux, partout. Tu peux saisir l’un ou l’autre, l’autre se calcule.</div></div>'
   +'<div class="card"><div class="row-title flex aic gap8">'+ic('trend','ic--sm')+'Pourquoi la ligne lissée ?</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">Ton poids varie de plus ou moins un kilo d’un jour à l’autre : eau, sel, sommeil, transit, séance de la veille. La ligne de tendance absorbe ce bruit. C’est elle qui dit si tu progresses, pas la pesée du jour.</div></div>'
   +'<div class="card"><div class="row-title flex aic gap8">'+ic('calendar','ic--sm')+'Et si je saute des jours ?</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">Rien de cassé. Les trous sont visibles sur les courbes (trait pointillé), les moyennes ne comptent que les jours réellement mesurés, et ta série tolère un jour manqué. Tu peux aussi ne saisir que le poids : toutes les autres mesures sont facultatives.</div></div>'
   +'<div class="card"><div class="row-title flex aic gap8">'+ic('pill','ic--sm')+'Les prises après la séance</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">Un créneau ancré sur l’entraînement ne s’affiche que les jours où tu as une séance. Les autres jours, il descend dans « Sans objet aujourd’hui » — sans compter contre toi — et reste cochable si tu l’as pris quand même.</div></div>'
   +'<div class="card"><div class="row-title flex aic gap8">'+ic('clock','ic--sm')+'Les rappels</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">iPhone n’autorise pas une application web à envoyer des notifications programmées. Élan te rappelle tes prises et tes séances à chaque ouverture. Pour une vraie alarme, exporte tes créneaux vers ton Calendrier : l’alerte viendra alors d’iOS.</div></div>'
   +'<div class="card"><div class="row-title flex aic gap8">'+ic('save','ic--sm')+'Mes données</div>'
   +'<div class="small muted" style="margin-top:6px;line-height:1.55">Elles sont sur cet iPhone, et nulle part ailleurs. Tant que tu ouvres Élan régulièrement, elles ne bougent pas. Mais un téléphone se perd, se réinitialise, se remplace : une copie hors du téléphone, c’est dix secondes par semaine.</div>'
   +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/sauvegarde" style="margin-top:10px">Ouvrir la sauvegarde</button></div>'
   +'<div class="hint" style="margin-top:14px">Élan décrit tes chiffres. Ce n’est pas un outil médical : pour toute question de santé, parles-en à un professionnel.</div>';
}

/* ---------- Écran : Réglages ---------- */
function screenSettings(){
  const s=state.settings, p=s.profile;
  let h=backHead('Réglages','/plus');
  /* Tous les réglages s'enregistrent tout seuls quand on quitte le champ : pas de bouton
     « Enregistrer » à ne pas oublier. `data-set` dit où écrire, `data-type` comment lire. */
  h+='<div class="section-title">Profil</div><div class="card">'
   +'<div class="field"><label>Prénom (facultatif)</label><input class="input" id="stName" data-set="profile.firstName" data-type="text" value="'+esc(p.firstName||'')+'" placeholder="Comment t’appeler ?"></div>'
   +'<div class="row-2"><div class="field"><label>Taille (cm)</label><input class="input tnum" id="stHeight" data-set="profile.heightCm" data-type="int" data-min="120" data-max="230" data-rerender="1" inputmode="numeric" value="'+(p.heightCm||'')+'"></div>'
   +'<div class="field"><label>Année de naissance</label><input class="input tnum" id="stYear" data-set="profile.birthYear" data-type="int" data-min="1900" data-max="'+new Date().getFullYear()+'" inputmode="numeric" value="'+(p.birthYear||'')+'" placeholder="1999"></div></div>'
   +'<div class="field"><label>Sexe <span class="muted">(pour le métabolisme de base)</span></label>'
   +segHTML([['m','Homme'],['f','Femme']],p.sex,'st-sex','')+'</div>'
   +'<div class="field"><label>Tes journées <span class="muted">(hors sport)</span></label>'
   +'<div class="opt-list">'+JOBS.map(j=>'<button class="opt'+(currentJob().code===j.code?' is-active':'')+'" data-act="st-job" data-k="'+j.code+'">'
     +'<span class="opt-ic">'+ic(j.icon)+'</span><span class="opt-main"><b>'+esc(j.label)+'</b><span class="opt-sub">'+esc(j.hint)+'</span></span>'
     +'<span class="opt-tick">'+ic('check','ic--sm')+'</span></button>').join('')+'</div></div>'
   +'<div class="hint">Huit heures debout brûlent plus que trois séances par semaine : c’est la base du calcul de ta dépense. Enregistré automatiquement.</div></div>';

  h+='<div class="section-title">Objectif</div><div class="card">'
   +'<div class="flex between aic"><div><div class="row-title">'+(targetWeight()!=null?fmtKg(targetWeight()):'Aucun objectif')+'</div>'
   +'<div class="small muted">'+(state.settings.goal.date?('date cible : '+fmtDateShort(state.settings.goal.date)):'date estimée automatiquement')+'</div></div>'
   +'<button class="chip chip--act" data-act="edit-goal">Modifier</button></div>'
   +'<div class="divider"></div>'
   +'<div class="flex between aic"><div><div class="row-title">Point de départ</div>'
   +'<div class="small muted">'+(startDate()?(fmtKg(startWeight())+' le '+fmtDateShort(startDate())):'—')+'</div></div>'
   +'<button class="chip chip--act" data-act="edit-start">Ajuster</button></div></div>';

  h+='<div class="section-title">Modules</div><div class="card">'
   +toggleHTML('Sport',!!s.modules.sport,'mod-toggle',' data-k="sport"','séances, minutes, calendrier d’entraînement')
   +toggleHTML('Prévisions d’entraînement',!!s.modules.planning,'mod-toggle',' data-k="planning"','« aujourd’hui : badminton à 20h »')
   +toggleHTML('Calories mangées',!!s.modules.kcalIn,'mod-toggle',' data-k="kcalIn"','pour comprendre le lien avec ton poids')
   +toggleHTML('Pilulier',!!s.modules.pillbox,'mod-toggle',' data-k="pillbox"','médicaments, compléments, protéine')
   +'</div>';
  h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/metriques" style="margin-top:10px">'+ic('layers')+'Choisir mes mesures</button>';

  if(s.modules.sport){
    h+='<div class="section-title">Sport</div><div class="card">'
     +'<div class="row-2"><div class="field"><label>Objectif hebdo (min)</label><input class="input tnum" id="stWgMin" data-set="sport.weeklyGoalMin" data-type="int" data-min="0" data-max="2000" inputmode="numeric" value="'+(s.sport.weeklyGoalMin||0)+'"></div>'
     +'<div class="field"><label>Séances / semaine</label><input class="input tnum" id="stWgSes" data-set="sport.weeklyGoalSessions" data-type="int" data-min="0" data-max="21" inputmode="numeric" value="'+(s.sport.weeklyGoalSessions||0)+'"></div></div>'
     +'<div class="field"><label>Calories brûlées</label>'+segHTML([['estimate','Estimer'],['off','Ne pas afficher']],s.sport.kcalMode,'st-kcalmode','')+'</div>'
     +'<div class="hint">Enregistré automatiquement.</div></div>';
  }
  if(s.modules.pillbox){
    const P=s.pillbox;
    h+='<div class="section-title">Pilulier</div><div class="card">'
     +toggleHTML('Rappel sur l’accueil',!!P.showOnHome,'pillset-toggle',' data-k="showOnHome"')
     +'<div class="divider"></div>'
     +'<div class="small muted" style="margin-bottom:10px">Ces heures ne servent qu’à <b>classer</b> les prises dans le bon ordre. Tu peux valider quand tu veux.</div>'
     +'<div class="stat-label" style="margin-bottom:6px">Moments de la journée</div>'
     +'<div class="row-2">'+MOMENT_ORDER.filter(k=>k!=='peuimporte').map(k=>
        '<div class="field"><label>'+esc(MOMENT_LABEL[k])+'</label><input class="input" type="time" id="pt-'+k+'" data-set="pillbox.momentTimes.'+k+'" data-type="time" value="'+esc(P.momentTimes[k])+'"></div>').join('')+'</div>'
     +'<div class="stat-label" style="margin:10px 0 6px">Repas</div>'
     +'<div class="row-2">'+Object.keys(MEAL_LABEL).map(k=>
        '<div class="field"><label>'+esc(capit(MEAL_LABEL[k]))+'</label><input class="input" type="time" id="mt-'+k+'" data-set="pillbox.mealTimes.'+k+'" data-type="time" value="'+esc(P.mealTimes[k])+'"></div>').join('')+'</div>'
     +'<div class="stat-label" style="margin:10px 0 6px">Séance</div>'
     +'<div class="row-2"><div class="field"><label>Heure par défaut</label><input class="input" type="time" id="pwTime" data-set="pillbox.defaultWorkoutTime" data-type="time" value="'+esc(P.defaultWorkoutTime)+'"></div>'
     +'<div class="field"><label>Durée supposée (min)</label><input class="input tnum" id="pwDur" data-set="pillbox.defaultSessionMin" data-type="int" data-min="5" data-max="300" inputmode="numeric" value="'+P.defaultSessionMin+'"></div></div>'
     +'<div class="hint">Sert à placer « 15 min après la séance » quand l’heure réelle n’est pas connue. Enregistré automatiquement.</div></div>';
  }
  const af=activityFactor();
  h+='<div class="section-title">Énergie</div><div class="card">'
   +'<div class="field"><label>Niveau d’activité</label>'
   +'<select class="input" id="stPal">'
   +[['auto','Automatique (ton métier + tes séances)']]
     .concat(PAL.map(x=>[x.code,x.label+' — '+x.hint]))
     .map(o=>'<option value="'+o[0]+'"'+((s.energy.palMode==='auto'?'auto':s.energy.pal)===o[0]?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>'
   +'<div class="hint">'+(af.manual
      ?'Réglage manuel : facteur ×'+nf(af.f,2)+'.'
      :'Facteur actuel <b>×'+nf(af.f,2)+'</b> = '+esc(currentJob().label.toLowerCase())+' (×'+nf(af.base,2)+')'
        +(af.sport>0?' + tes séances (+'+nf(af.sport,2)+')':'')+'.')
   +(s.modules.kcalIn?' Élan calcule aussi ton <b>point neutre observé</b>, bien plus fiable.'
                     :' Active les <b>calories mangées</b> pour qu’Élan calcule ton point neutre réel.')
   +'</div></div>'
   +'<button class="btn btn--ghost btn--block" data-act="go" data-route="/simulateur" style="margin-top:10px">'+ic('calculator')+'Simulateur de projection</button>'
   +'</div>';
  h+='<div class="section-title">Affichage</div><div class="card">'
   +'<div class="field"><label>Couleur d’accent</label>'
   +segHTML([['vert','Vert'],['ocean','Océan'],['violet','Violet'],['corail','Corail']],s.accentTheme,'st-accent','seg--sm')+'</div>'
   +'<div class="field"><label>Écran de démarrage</label>'
   +segHTML([['/','Accueil'],['/courbes','Courbes'],['/tableau','Tableau']],s.firstScreen,'st-first','seg--sm')+'</div>'
   +'<div class="field"><label>Densité</label>'+segHTML([['comfortable','Confort'],['compact','Compact']],s.density,'st-density','')+'</div>'
   +toggleHTML('Masquer les chiffres',!!s.numberPrivacy,'st-toggle',' data-k="numberPrivacy"','floute les valeurs — garde le doigt appuyé pour les révéler')
   +toggleHTML('Vibrations',s.hapticsOn!==false,'st-toggle',' data-k="hapticsOn"')
   +toggleHTML('Célébrations',s.celebrateOn!==false,'st-toggle',' data-k="celebrateOn"','confettis quand tu franchis un palier')
   +toggleHTML('Réduire les animations',s.reduceMotion===true,'st-toggle',' data-k="reduceMotion"')
   +'</div>';
  h+='<div class="section-title">Barre du bas</div><div class="card">'
   +'<div class="small muted" style="margin-bottom:10px">Choisis jusqu’à deux raccourcis supplémentaires. Accueil, Plus et le bouton central restent toujours en place.</div>'
   +'<div class="chip-wrap">'+TAB_CHOICES.filter(c=>!c.fixed&&(!c.mod||s.modules[c.mod])).map(c=>{
      const on=tabList().indexOf(c.route)>=0;
      return '<button class="chip'+(on?' is-active':'')+'" data-act="st-tab" data-r="'+c.route+'">'
        +ic(on?'check':'plus','ic--sm')+esc(c.label)+'</button>'; }).join('')+'</div>'
   +'<div class="hint" style="margin-top:10px">'+tabList().length+' onglets sur 6 possibles.</div></div>';
  h+=sectionTitle('Application')+updateCard();
  h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/sauvegarde" style="margin-top:12px">'+ic('save')+'Sauvegarde et synchronisation</button>';
  h+='<button class="btn btn--ghost btn--block" data-act="go" data-route="/aide" style="margin-top:8px">'+ic('help')+'Aide</button>';
  h+='<div class="small muted center" style="margin-top:20px">Élan v'+esc(state.meta.appVersion)+' · '+storageUsedText()+' utilisés</div>';
  return h;
}
function startEditor(){
  openSheet('Point de départ',
    '<div class="small muted" style="margin-bottom:12px">Par défaut, Élan prend ta première pesée (moyenne des 7 premiers jours). Tu peux fixer un autre point de départ, par exemple si tu as commencé avant d’installer l’app.</div>'
    +'<div class="row-2"><div class="field"><label>Date</label><input class="input" type="date" id="soDate" value="'+((state.settings.startOverride&&state.settings.startOverride.date)||startDate()||isoToday())+'"></div>'
    +'<div class="field"><label>Poids (kg)</label><input class="input tnum" id="soKg" inputmode="decimal" value="'+((state.settings.startOverride&&state.settings.startOverride.weightKg)||(startWeight()!=null?nf(startWeight(),1):''))+'"></div></div>'
    +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="start-save">Enregistrer</button>'
    +(state.settings.startOverride?'<button class="btn btn--ghost btn--block" data-act="start-clear" style="margin-top:8px">Revenir au calcul automatique</button>':'')
    +'</div>');
}

/* ============================================================
   SAUVEGARDE ET SYNCHRONISATION
   ------------------------------------------------------------
   Trois niveaux complémentaires : local (instantanés), fichier
   (le vrai filet, hors du téléphone) et copie cloud optionnelle
   dans un gist GitHub secret. Le jeton ne quitte jamais
   l'appareil et ne figure dans AUCUN export.
   ============================================================ */
function backupCounts(d){ const o={}; COLLECTIONS.forEach(c=>{ o[c.key]=(d[c.key]||[]).length; }); return o; }
function entriesRange(d){ const ds=(d.entries||[]).map(e=>e.date).filter(Boolean).sort();
  return ds.length?{from:ds[0],to:ds[ds.length-1]}:{from:null,to:null}; }
/* Ceinture et bretelles : même si un champ sensible se glissait dans state, il ne sortirait pas. */
function scrubSecrets(o){
  const bad=/(token|pat|secret|password|apikey|api_key)/i;
  const walk=v=>{ if(!v||typeof v!=='object') return v;
    if(Array.isArray(v)) return v.map(walk);
    const r={}; for(const k in v){ if(bad.test(k)) continue; r[k]=walk(v[k]); } return r; };
  return walk(o);
}
function buildBackup(){
  const data=scrubSecrets(state);
  return {_app:'Elan',_note:'Sauvegarde Elan. Ne pas modifier a la main. Reimporter via Elan > Sauvegarde > Importer.',
    schemaVersion:state.schemaVersion||CURRENT_SCHEMA,appVersion:state.meta.appVersion||'1.0',
    exportedAt:new Date().toISOString(),device:{id:state.meta.deviceId,name:state.meta.deviceName||''},
    rev:state.meta.rev|0,counts:backupCounts(data),range:entriesRange(data),data:data};
}
function backupText(pretty){ return JSON.stringify(buildBackup(),null,pretty===false?0:2); }
function markBackedUp(kind){
  if(kind==='cloud') state.meta.lastCloudAt=new Date().toISOString();
  else state.meta.lastBackupAt=new Date().toISOString();
  saveNow();                     // pas de touch() : sauvegarder n'est pas une mutation de données
}
function snapshotPrev(reason){
  try{ safeSet(K_PREV,JSON.stringify({savedAt:new Date().toISOString(),reason:reason||'',
    rev:state.meta.rev,counts:backupCounts(state),data:state})); }catch(e){}
}
function snapRead(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
function dailySnapshot(){
  const last=state.meta.lastSnapAt?Date.parse(state.meta.lastSnapAt):0;
  if(Date.now()-last<20*3600*1000) return false;
  if(!(state.entries||[]).length) return false;
  const payload=JSON.stringify({savedAt:new Date().toISOString(),rev:state.meta.rev,counts:backupCounts(state),data:state});
  let s1=null,s2=null,s3=null;
  try{ s1=localStorage.getItem('elan.snap.1'); s2=localStorage.getItem('elan.snap.2'); s3=localStorage.getItem('elan.snap.3'); }catch(e){}
  try{
    if(s2) localStorage.setItem('elan.snap.3',s2);
    if(s1) localStorage.setItem('elan.snap.2',s1);
  }catch(e){}
  if(!safeSet('elan.snap.1',payload)){
    /* L'instantané n'a pas pu être écrit : on remet les anciens en place plutôt que
       de perdre deux points de restauration pour rien. */
    try{
      if(s1!=null) localStorage.setItem('elan.snap.1',s1); else localStorage.removeItem('elan.snap.1');
      if(s2!=null) localStorage.setItem('elan.snap.2',s2); else localStorage.removeItem('elan.snap.2');
      if(s3!=null) localStorage.setItem('elan.snap.3',s3); else localStorage.removeItem('elan.snap.3');
    }catch(e){}
    return false;
  }
  state.meta.lastSnapAt=new Date().toISOString(); saveNow(); return true;
}
function restorePoints(){
  const out=[];
  const p=snapRead(K_PREV);
  if(p) out.push({key:K_PREV,label:'Filet de sécurité',sub:p.reason||'avant une opération',at:p.savedAt,counts:p.counts});
  ['elan.snap.1','elan.snap.2','elan.snap.3'].forEach((k,i)=>{ const s=snapRead(k);
    if(s) out.push({key:k,label:'Instantané '+(i===0?'du jour':'J-'+i),sub:'automatique',at:s.savedAt,counts:s.counts}); });
  return out;
}
function restoreFrom(k){
  const s=snapRead(k); if(!s||!s.data){ toast('Point de restauration illisible'); return; }
  const n=(s.counts&&s.counts.entries)||0, cur=state.entries.length;
  confirmSheet('Restaurer','Revenir à l’état du '+fmtDateTime(s.savedAt)+' ('+n+' pesées'
    +(cur>n?(', tu en perdrais '+(cur-n)):'')+') ? Un filet de sécurité est gardé.',()=>{
    LOAD_ERROR=null; snapshotPrev('avant restauration'); state=migrate(s.data); invalidateCache(); saveNow(); closeSheet(); nav('/'); render(); toast('État restauré ✓');
  },true,'Restaurer');
}
function storageUsedText(){
  let n=0; try{ for(const k in localStorage) if(k.indexOf('elan.')===0) n+=(localStorage.getItem(k)||'').length*2; }catch(e){}
  return n<1024?n+' o':(n<1048576?Math.round(n/1024)+' Ko':(n/1048576).toFixed(1)+' Mo');
}
function externalBackupAgeDays(){
  const t=Math.max(Date.parse(state.meta.lastBackupAt||0)||0,Date.parse(state.meta.lastCloudAt||0)||0);
  return t?((Date.now()-t)/86400000):Infinity;
}
function backupOverdue(){ return (state.entries||[]).length>0&&externalBackupAgeDays()>7; }

async function shareBackup(){
  const text=backupText(true), fname='elan-sauvegarde-'+isoToday()+'.json';
  try{
    if(navigator.canShare&&window.File){
      const file=new File([text],fname,{type:'application/json'});
      if(navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:'Sauvegarde Élan'}); markBackedUp('file'); render(); return; }
    }
  }catch(e){ if(e&&e.name==='AbortError') return; }
  try{ if(navigator.share){ await navigator.share({title:'Sauvegarde Élan',text:text}); markBackedUp('file'); render(); return; } }
  catch(e){ if(e&&e.name==='AbortError') return; }
  downloadBackup();
}
function downloadBackup(ext){
  const text=backupText(true);
  const blob=new Blob([text],{type:ext==='txt'?'text/plain':'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='elan-sauvegarde-'+isoToday()+'.'+(ext||'json');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  markBackedUp('file'); toast('Sauvegarde téléchargée ✓'); render();
}
function copyBackup(){
  const text=backupText(true);
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(()=>{ markBackedUp('file'); toast('Sauvegarde copiée ✓ — colle-la dans Notes ou un mail'); render(); },
      ()=>toast('Copie impossible'));
  else toast('Copie non supportée ici');
}
function migrateSchema(d,from){ return d; }
function parseBackup(txt){
  let p; try{ p=JSON.parse(txt); }catch(e){ return {error:'Fichier illisible : ce n’est pas une sauvegarde Élan (JSON invalide).'}; }
  let data=(p&&p.data)?p.data:p;
  if(!data||typeof data!=='object') return {error:'Ce fichier ne contient pas de données Élan.'};
  const hasAny=COLLECTIONS.some(c=>Array.isArray(data[c.key]));
  if(!hasAny&&!data.settings) return {error:'Ce fichier n’est pas une sauvegarde Élan.'};
  if(p&&p._app&&p._app!=='Elan') return {error:'Cette sauvegarde vient d’une autre application ('+String(p._app).slice(0,20)+').'};
  const ver=(p&&p.schemaVersion)||data.schemaVersion||1;
  if(ver>CURRENT_SCHEMA) return {error:'Sauvegarde créée par une version plus récente d’Élan (v'+ver+'). Mets Élan à jour, puis réessaie.'};
  data=migrateSchema(data,ver);
  return {data:data,ver:ver,exportedAt:(p&&p.exportedAt)||null,device:(p&&p.device)||null,rev:(p&&p.rev)|0,
    counts:backupCounts(data),range:entriesRange(data)};
}
function dedupeKey(it,c){ return c.dedupe.split('|').map(f=>String(it[f]==null?'':it[f])).join('|'); }
function indexBy(arr,c){ const m={}; arr.forEach(x=>{ m[dedupeKey(x,c)]=x; }); return m; }
/* Fusion champ par champ : un jour où l'appareil A n'a que le poids et B la masse grasse
   doit produire une ligne complète, jamais une ligne dégradée. */
function mergeEntry(a,b){
  const out=Object.assign({},a,{m:Object.assign({},a.m)});
  let changed=false;
  const bm=b.m||{};
  for(const k in bm){
    const bv=bm[k]; if(!bv||bv.v==null) continue;
    const av=out.m[k];
    if(!av||av.v==null){ out.m[k]=bv; changed=true; continue; }
    if(av.v===bv.v&&av.u===bv.u) continue;
    const at=Date.parse(a.updatedAt||a.createdAt||0)||0, bt=Date.parse(b.updatedAt||b.createdAt||0)||0;
    if(bt>at){ out.m[k]=bv; changed=true; }
  }
  if(!out.note&&b.note){ out.note=b.note; changed=true; }
  if(changed) out.updatedAt=new Date().toISOString();
  return {value:out,changed:changed};
}
function mergeCollection(c,cur,inc){
  const idx=indexBy(cur,c);
  inc.forEach(it=>{
    const k=dedupeKey(it,c), ex=idx[k];
    if(!ex){ cur.push(it); idx[k]=it; return; }
    if(c.key==='entries'){ const m=mergeEntry(ex,it); if(m.changed) Object.assign(ex,m.value); }
  });
  if(c.dedupe.indexOf('date')===0) cur.sort((a,b)=>a.date<b.date?-1:1);
  return cur;
}
function previewMerge(data){
  const out={};
  COLLECTIONS.forEach(c=>{
    const cur=state[c.key]||[], inc=data[c.key]||[];
    const idx=indexBy(cur,c); let added=0,updated=0,identical=0;
    inc.forEach(it=>{ const k=dedupeKey(it,c), ex=idx[k];
      if(!ex){ added++; return; }
      if(c.key==='entries'){ const m=mergeEntry(ex,it); if(m.changed) updated++; else identical++; }
      else identical++; });
    out[c.key]={current:cur.length,incoming:inc.length,added:added,updated:updated,identical:identical};
  });
  return out;
}
let IMPORT_STAGE=null;
function showImportPreview(res){
  if(res.error){ toast(res.error); return; }
  IMPORT_STAGE=res;
  const pv=previewMerge(res.data);
  const nothing=COLLECTIONS.every(c=>pv[c.key].added===0&&pv[c.key].updated===0);
  const localEmpty=!state.entries.length;
  let h='<div class="card card--flat"><div class="small">Sauvegarde du '+esc(res.exportedAt?fmtDateTime(res.exportedAt):'?')+'</div>'
   +'<div class="small muted">Version '+res.ver+(res.device&&res.device.name?' · appareil « '+esc(res.device.name)+' »':'')+'</div>'
   +(res.range.from?'<div class="small muted">Période : '+esc(fmtDateShort(res.range.from))+' → '+esc(fmtDateShort(res.range.to))+'</div>':'')
   +'</div>';
  if(nothing) h+='<div class="card card--warn" style="margin-top:10px"><div class="small">Cette sauvegarde n’apporte rien de nouveau. Tu as déjà tout ce qu’elle contient.</div></div>';
  h+='<div class="section-title">Ce que ça va changer</div><div class="card">'
   +COLLECTIONS.filter(c=>pv[c.key].incoming>0||pv[c.key].current>0).map(c=>{
     const x=pv[c.key];
     return '<div class="kv"><span class="kv-k">'+esc(c.label)+'</span><span class="kv-v">'+x.current+' → '+(x.current+x.added)
       +(x.added?' <span class="down">(+'+x.added+')</span>':'')+(x.updated?' <span class="muted small">'+x.updated+' complétées</span>':'')+'</span></div>'; }).join('')
   +'</div>';
  /* Les réglages ne se « fusionnent » pas : soit on garde les siens, soit on reprend ceux
     de la sauvegarde. On le dit, et on laisse choisir — coché par défaut sur un téléphone
     neuf (c'est le cas du changement d'appareil), décoché si l'app est déjà configurée. */
  h+='<div class="card">'
   +toggleHTML('Reprendre aussi les réglages',localEmpty,'imp-settings',' id="impSettings"',
      'profil, objectif, modules, mesures affichées et préférences')
   +'<div class="hint">Décoché, tes réglages actuels sont conservés tels quels.</div></div>';
  h+='<div class="sheet-foot">'
   +'<button class="btn btn--primary btn--block" data-act="bk-do-import" data-mode="merge">'+ic('shuffle')+(localEmpty?'Restaurer mes données':'Fusionner — recommandé')+'</button>'
   +'<div class="hint" style="margin:6px 0 10px">Rien de ce que tu as ne sera perdu.</div>'
   +(localEmpty?'':'<button class="btn btn--danger btn--block" data-act="bk-do-import" data-mode="replace">'+ic('refresh')+'Tout remplacer</button>')
   +'</div>';
  openSheet('Importer une sauvegarde',h);
}
function applyImport(data,mode,withSettings){
  LOAD_ERROR=null;
  snapshotPrev(mode==='replace'?'avant remplacement par une sauvegarde':'avant fusion d’une sauvegarde');
  const avant=JSON.parse(JSON.stringify(state));   // filet en mémoire : une fusion est tout ou rien
  try{
  if(mode==='replace'){ state=migrate(data); }
  else{
    COLLECTIONS.forEach(c=>{ state[c.key]=mergeCollection(c,state[c.key]||[],data[c.key]||[]); });
    if(withSettings){
      state.settings=deepDefaults(Object.assign({},state.settings,data.settings||{}),defaultDB().settings);
      /* `ui` porte aussi des décisions de l'utilisateur (les jours « sans pesée » assumés) :
         les perdre au changement de téléphone casserait sa série pour rien. */
      const ui=data.ui||{};
      state.ui=Object.assign({},state.ui,ui,{skippedDays:Object.assign({},state.ui.skippedDays||{},ui.skippedDays||{})});
    } else {
      const ui=data.ui||{};
      state.ui.skippedDays=Object.assign({},state.ui.skippedDays||{},ui.skippedDays||{});
    }
    state=migrate(state);
  }
  }catch(err){
    state=avant; invalidateCache(); saveNow(); closeSheet(); render();
    toast('Import interrompu — rien n’a été modifié');
    return;
  }
  touch(); invalidateCache(); saveNow(); closeSheet(); nav('/'); render();
  toast(mode==='replace'?'Données remplacées ✓':'Fusion terminée ✓');
}
/* ---------- Synchro cloud (gist secret) ---------- */
function syncCfg(){ try{ return JSON.parse(localStorage.getItem(K_SYNC)||'null')||{provider:'gist',auto:true,status:'off'}; }
  catch(e){ return {provider:'gist',auto:true,status:'off'}; } }
function saveSyncCfg(c){ try{ localStorage.setItem(K_SYNC,JSON.stringify(c)); }catch(e){} }
function syncOn(){ const c=syncCfg(); return !!(c.token&&c.gistId&&c.status!=='off'); }
function maskToken(t){ return t?(t.slice(0,12)+'…'+t.slice(-4)):''; }
const GH='https://api.github.com';
function ghHeaders(tok,withJson){
  const h={'Authorization':'Bearer '+tok,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(withJson) h['Content-Type']='application/json';
  return h;
}
async function ghFetch(path,opts){
  opts=opts||{};
  const c=syncCfg(); if(!c.token) throw {kind:'notoken'};
  const ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),12000);
  let res;
  try{ res=await fetch(GH+path,{method:opts.method||'GET',headers:ghHeaders(c.token,!!opts.body),
    body:opts.body?JSON.stringify(opts.body):undefined,signal:ctl.signal,cache:'no-store'}); }
  catch(e){ clearTimeout(to); throw {kind:(e&&e.name==='AbortError')?'timeout':'offline'}; }
  clearTimeout(to);
  if(res.ok) return res.json();
  const body=await res.text().catch(()=>'');
  throw {kind:'http',status:res.status,body:body,
    rlRemaining:res.headers.get('x-ratelimit-remaining'),rlReset:res.headers.get('x-ratelimit-reset')};
}
function cloudPayload(){ const b=buildBackup(); b.syncedAt=new Date().toISOString(); return JSON.stringify(b); }
async function cloudCreate(){
  const g=await ghFetch('/gists',{method:'POST',body:{description:'Élan — sauvegarde automatique (privé, ne pas partager)',
    public:false,files:{'elan-sauvegarde.json':{content:cloudPayload()}}}});
  const c=syncCfg(); c.gistId=g.id; c.gistUrl=g.html_url; c.status='ok'; c.fileName='elan-sauvegarde.json';
  c.createdAt=new Date().toISOString(); c.lastRemoteRev=state.meta.rev; c.lastLocalRev=state.meta.rev;
  c.lastSyncAt=new Date().toISOString(); c.lastError=null; saveSyncCfg(c); markBackedUp('cloud'); return g;
}
async function cloudPush(){
  const c=syncCfg();
  const files={}; files[c.fileName||'elan-sauvegarde.json']={content:cloudPayload()};
  await ghFetch('/gists/'+c.gistId,{method:'PATCH',body:{files:files}});
  const n=syncCfg(); n.lastRemoteRev=state.meta.rev; n.lastLocalRev=state.meta.rev;
  n.lastSyncAt=new Date().toISOString(); n.status='ok'; n.lastError=null; saveSyncCfg(n);
  markBackedUp('cloud');
}
async function cloudRead(){
  const c=syncCfg();
  const g=await ghFetch('/gists/'+c.gistId);
  const f=g.files&&(g.files[c.fileName||'elan-sauvegarde.json']||g.files[Object.keys(g.files)[0]]);
  if(!f) throw {kind:'nofile'};
  let txt=f.content;
  if(f.truncated&&f.raw_url){ const r=await fetch(f.raw_url,{cache:'no-store'}); txt=await r.text(); }
  const parsed=parseBackup(txt);
  if(parsed.error) throw {kind:'badremote',msg:parsed.error};
  parsed.updatedAt=g.updated_at;
  return parsed;
}
async function cloudPull(remote){
  LOAD_ERROR=null;
  snapshotPrev('avant récupération de la copie cloud');
  state=migrate(remote.data); invalidateCache(); saveNow();
  const c=syncCfg(); c.lastRemoteRev=remote.rev; c.lastLocalRev=state.meta.rev;
  c.lastSyncAt=new Date().toISOString(); c.status='ok'; c.lastError=null; saveSyncCfg(c);
  markBackedUp('cloud'); render();
}
let SYNC_BUSY=false, SYNC_STATE='idle', SYNC_REMOTE=null;
async function syncNow(manual){
  if(SYNC_BUSY) return;
  const c=syncCfg();
  if(!syncOn()) return;
  if(!manual){
    if(c.auto===false) return;
    if(c.lastAutoAt&&Date.now()-Date.parse(c.lastAutoAt)<5*60*1000) return;
  }
  SYNC_BUSY=true; SYNC_STATE='sync'; paintSyncBadge();
  try{
    const remote=await cloudRead();
    SYNC_REMOTE=remote;
    const localChanged=(state.meta.rev|0)!==(c.lastLocalRev|0);
    const remoteChanged=(remote.rev|0)!==(c.lastRemoteRev|0);
    if(!localChanged&&!remoteChanged){ /* rien à faire */ }
    else if(localChanged&&!remoteChanged){ await guardedPush(remote); }
    else if(!localChanged&&remoteChanged){ await cloudPull(remote); toast('Données récupérées du cloud ✓'); }
    else { divergenceSheet(remote); }
    const n=syncCfg(); n.lastAutoAt=new Date().toISOString(); n.lastError=null; n.status='ok'; saveSyncCfg(n);
    SYNC_STATE='ok';
    if(manual) toast('Synchronisé ✓');
  }catch(e){
    /* Copie cloud vide ou illisible : on tient la promesse faite à l'utilisateur
       et on la remplace tout de suite par l'état local (s'il y a quelque chose à pousser). */
    if((e.kind==='nofile'||e.kind==='badremote')&&(state.entries||[]).length){
      try{ await cloudPush(); SYNC_STATE='ok'; toast('Copie cloud reconstruite ✓'); }
      catch(e2){ SYNC_STATE='err'; handleSyncError(e2,manual); }
    } else { SYNC_STATE='err'; handleSyncError(e,manual); }
  }
  finally{ SYNC_BUSY=false; paintSyncBadge(); }
}
/* Garde-fou : ne JAMAIS écraser un cloud fourni par un local vide ou très appauvri. */
async function guardedPush(remote){
  /* On compare TOUTES les collections, pas seulement les pesées : un local vidé de ses
     séances ou de ses prises ne doit pas écraser une copie cloud qui les contient. */
  let localTotal=0,remoteTotal=0,shrink=false;
  COLLECTIONS.forEach(c=>{
    const l=(state[c.key]||[]).length, r=((remote.counts&&remote.counts[c.key])|0);
    localTotal+=l; remoteTotal+=r;
    if(r>=5&&l<r*0.5) shrink=true;
  });
  if(localTotal===0&&remoteTotal>0){ divergenceSheet(remote,'empty'); return; }
  if(shrink||(remoteTotal>0&&localTotal<remoteTotal*0.5)){ divergenceSheet(remote,'shrink'); return; }
  await cloudPush();
}
function divergenceSheet(remote,mode){
  SYNC_REMOTE=remote;
  const localN=(state.entries||[]).length, remoteN=(remote.counts&&remote.counts.entries)|0;
  openSheet('Deux versions différentes',
    '<div class="small muted" style="margin-bottom:12px">'
    +(mode==='empty'?'Cet appareil n’a aucune pesée alors que la copie cloud en contient '+remoteN+'. On ne va rien écraser sans te demander.'
      :(mode==='shrink'?'Cet appareil a beaucoup moins de données que la copie cloud. On préfère te demander.'
        :'Tu as modifié Élan ici, et la copie cloud a aussi changé de son côté. Choisis — rien ne sera perdu.'))+'</div>'
    +'<div class="card card--flat"><div class="kv"><span class="kv-k">Sur cet iPhone</span><span class="kv-v">'+localN+' pesées</span></div>'
    +'<div class="kv"><span class="kv-k">Dans le cloud</span><span class="kv-v">'+remoteN+' pesées'
    +(remote.updatedAt?' · '+esc(agoText(remote.updatedAt)):'')+'</span></div></div>'
    +'<div class="sheet-foot">'
    +'<button class="btn btn--primary btn--block" data-act="sync-resolve" data-how="merge">'+ic('shuffle')+'Fusionner les deux — recommandé</button>'
    +'<div class="hint" style="margin:6px 0 10px">Garde tout, complète les trous, aucun doublon.</div>'
    +'<button class="btn btn--ghost btn--block" data-act="sync-resolve" data-how="local">'+ic('phone')+'Garder cet iPhone</button>'
    +'<button class="btn btn--ghost btn--block" data-act="sync-resolve" data-how="cloud" style="margin-top:8px">'+ic('cloud')+'Prendre la version cloud</button>'
    +'<button class="btn btn--ghost btn--block" data-act="close-sheet" style="margin-top:8px">Plus tard</button>'
    +'</div>');
}
function handleSyncError(e,manual){
  const c=syncCfg(); let msg='', fatal=false;
  if(e.kind==='offline') msg='Hors-ligne — tes données restent enregistrées sur l’iPhone. Synchro à la prochaine ouverture.';
  else if(e.kind==='timeout') msg='GitHub ne répond pas. On réessaiera tout seul.';
  else if(e.kind==='notoken'){ msg='Aucun jeton enregistré.'; fatal=true; }
  else if(e.kind==='nofile') msg='La copie cloud est vide. Elle sera remplacée à la prochaine sauvegarde.';
  else if(e.kind==='badremote') msg='La copie cloud est illisible. Elle sera remplacée à la prochaine sauvegarde.';
  else if(e.kind==='http'){
    if(e.status===401){ msg='Jeton refusé : il a expiré ou été révoqué. Recolle un nouveau jeton.'; fatal=true; c.status='invalid'; }
    else if(e.status===403){
      if(e.rlRemaining==='0'){ const m=Math.max(1,Math.ceil((Number(e.rlReset)*1000-Date.now())/60000));
        msg='Trop de requêtes GitHub. Réessaie dans '+m+' min.'; }
      else { msg='Le jeton n’a pas la permission « Gists ». Recrée-le avec Gists : Read and write.'; fatal=true; c.status='invalid'; }
    }
    else if(e.status===404){ msg='La copie cloud est introuvable (supprimée, ou elle appartient à un autre compte).'; fatal=true; c.status='invalid'; }
    else if(e.status===422){ msg='GitHub a refusé le contenu de la sauvegarde.'; fatal=true; }
    else msg='Erreur GitHub ('+e.status+').';
  } else msg='Erreur de synchronisation.';
  c.lastError={at:new Date().toISOString(),msg:msg}; saveSyncCfg(c);
  if(manual||fatal) toast(msg);
  render();
}
function paintSyncBadge(){
  const el=document.getElementById('syncDot'); if(!el) return;
  const c=syncCfg();
  el.className='sync-dot '+(SYNC_STATE==='sync'?'sync':(c.status==='invalid'?'err':(c.lastError?'warn':(syncOn()?'ok':''))));
}
function syncSetupHTML(){
  return '<div class="small muted" style="margin-bottom:12px">Tes chiffres se copient tout seuls chez GitHub à chaque ouverture. Gratuit, aucun nouveau compte à créer (tu en as déjà un), cinq minutes à régler une seule fois.</div>'
   +'<div class="steps">'
   +[['Sur ton iPhone, ouvre <b>github.com</b> et connecte-toi.'],
     ['Menu (ta photo) → <b>Settings</b>.'],
     ['Tout en bas : <b>Developer settings</b>.'],
     ['<b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.'],
     ['Nom : <b>Élan iPhone</b> · Expiration : <b>1 an</b> (note la date). Repository access : <b>Public repositories (read-only)</b>.'],
     ['<b>Account permissions</b> → cherche <b>Gists</b> → mets <b>Read and write</b>.'],
     ['<b>Generate token</b>, puis <b>copie le jeton</b> (il commence par github_pat_). GitHub ne te le remontrera jamais.'],
     ['Reviens ici et colle-le ci-dessous.']]
     .map((s,i)=>'<div class="step"><div class="step-n">'+(i+1)+'</div><div class="step-txt">'+s[0]+'</div></div>').join('')
   +'</div>'
   +'<div class="hint">Tu ne trouves pas « Gists » ? Utilise l’ancien format : Tokens (classic) → Generate new token → coche uniquement la case « gist ». Il commence par ghp_.</div>'
   +'<div class="field" style="margin-top:14px"><label>Ton jeton</label>'
   +'<input class="input" id="ghToken" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="github_pat_…"></div>'
   +'<div class="hint">Ce jeton reste sur cet iPhone. Il n’apparaît dans aucun export et n’est jamais envoyé ailleurs qu’à GitHub. Si tu penses qu’il a fuité, révoque-le : GitHub le désactive instantanément et Élan continue de marcher en local.</div>'
   +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="sync-save-token">Activer la sauvegarde cloud</button>'
   +'<button class="btn btn--ghost btn--block" data-act="sync-link" style="margin-top:8px">J’ai déjà une copie cloud</button></div>';
}
function saveTokenAndInit(){
  const el=document.getElementById('ghToken');
  const t=((el&&el.value)||'').trim();
  if(!/^(github_pat_|ghp_|gho_)/.test(t)){ toast('Ce n’est pas un jeton GitHub (il commence par github_pat_ ou ghp_).'); return; }
  const c=syncCfg(); c.token=t; c.provider='gist'; c.fileName='elan-sauvegarde.json'; c.status='ok'; c.auto=true; saveSyncCfg(c);
  if(el) el.value='';
  (c.gistId?cloudPush():cloudCreate()).then(()=>{ closeSheet(); render(); toast('Sauvegarde cloud activée ✓'); })
    .catch(e=>handleSyncError(e,true));
}
function linkGistHTML(){
  return '<div class="small muted" style="margin-bottom:12px">Colle l’identifiant du gist créé par Élan sur ton ancien téléphone (il apparaît sous le bouton « Synchroniser maintenant »).</div>'
   +'<div class="field"><label>Identifiant du gist</label><input class="input" id="gistId" autocomplete="off" placeholder="9c1e4f2b7a3d…"></div>'
   +'<div class="sheet-foot"><button class="btn btn--primary btn--block" data-act="sync-link-save">Relier</button></div>';
}
function phoneGuideHTML(){
  const steps=[
    ['<b>Sur l’ancien iPhone</b> — ouvre Élan → Sauvegarde.'],
    ['Appuie sur <b>Partager la sauvegarde</b>.'],
    ['Choisis <b>Enregistrer dans Fichiers</b> → iCloud Drive → dossier Élan. Vérifie que le fichier apparaît bien dans l’app Fichiers.'],
    ['Si la synchro cloud est active : <b>Synchroniser maintenant</b>, et note l’identifiant du gist affiché.'],
    ['<b>Sur le nouvel iPhone</b> — Safari → l’adresse d’Élan → Partager → <b>Sur l’écran d’accueil</b>.'],
    ['Ouvre Élan depuis l’icône (pas depuis Safari) → Sauvegarde → <b>Importer depuis un fichier</b> → Fichiers → iCloud Drive → Élan.'],
    ['Vérifie l’aperçu (nombre de pesées, période), puis <b>Fusionner</b>.'],
    ['Contrôle : sur l’accueil, le nombre de jours depuis le début et le poids de départ sont-ils les bons ? Dans le tableau, ta toute première pesée est-elle là ?']];
  return '<div class="steps">'+steps.map((s,i)=>'<div class="step"><div class="step-n">'+(i+1)+'</div><div class="step-txt">'+s[0]+'</div></div>').join('')+'</div>'
   +'<div class="hint" style="margin-top:12px">Ne supprime jamais Élan de l’ancien iPhone avant d’avoir vu tes chiffres sur le nouveau.</div>';
}
function screenBackup(){
  const c=syncCfg(), n=state.entries.length;
  let h=backHead('Sauvegarde','/plus');
  const age=externalBackupAgeDays();
  const cls=n===0?'':(age>7?' card--warn':(syncOn()?' card--ok':''));
  h+='<div class="card'+cls+'">'
   +'<div class="sync-line"><span class="sync-dot '+(syncOn()?'ok':'')+'" id="syncDot"></span>'
   +'<div class="grow"><div class="row-title">'+(syncOn()?'Copie cloud':'Pas de copie cloud')+'</div></div>'
   +'<div class="small muted">'+esc(agoText(state.meta.lastCloudAt))+'</div></div>'
   +'<div class="kv"><span class="kv-k">Fichier</span><span class="kv-v">'+esc(agoText(state.meta.lastBackupAt))+'</span></div>'
   +'<div class="kv"><span class="kv-k">Sur cet iPhone</span><span class="kv-v">'+n+' '+plural(n,'pesée')
   +((state.sessions||[]).length?' · '+state.sessions.length+' '+plural(state.sessions.length,'séance'):'')+'</span></div>'
   +(startDate()?'<div class="kv"><span class="kv-k">Depuis le</span><span class="kv-v">'+esc(fmtDateShort(startDate()))+' ('+sinceStartDays()+' jours)</span></div>':'')
   +'</div>';
  if(n===0) return h+'<div class="card"><div class="small muted">Rien à sauvegarder pour l’instant. Saisis ta première pesée.</div></div>';

  h+='<div class="section-title">Mettre à l’abri</div><div class="card">'
   +'<div class="small muted" style="margin-bottom:10px">Un seul fichier contient tout. Range-le dans Fichiers → iCloud Drive : il survivra à ton téléphone.</div>'
   +'<button class="btn btn--primary btn--block" data-act="bk-share">'+ic('upload')+'Partager la sauvegarde</button>'
   +'<div class="btn-row" style="margin-top:8px"><button class="btn btn--ghost" data-act="bk-download">'+ic('save')+'Télécharger</button>'
   +'<button class="btn btn--ghost" data-act="bk-copy">'+ic('table')+'Copier</button></div></div>';

  h+='<div class="section-title">Sauvegarde automatique dans le cloud</div>';
  if(c.status==='invalid'){
    h+='<div class="card card--danger"><div class="row-title flex aic gap8">'+ic('alert','ic--sm')+'Synchro en panne</div>'
     +'<div class="small muted" style="margin:6px 0 10px">'+esc(c.lastError?c.lastError.msg:'Jeton refusé.')+'</div>'
     +'<button class="btn btn--primary btn--block" data-act="sync-setup">'+ic('key')+'Coller un nouveau jeton</button>'
     +'<button class="btn btn--ghost btn--block" data-act="sync-disable" style="margin-top:8px">'+ic('ban')+'Désactiver la synchro</button></div>';
  } else if(syncOn()){
    h+='<div class="card"><div class="small muted">Gist secret GitHub · <span class="code-box" style="display:inline-block;padding:2px 6px">'+esc(maskToken(c.token))+'</span></div>'
     +'<div class="kv"><span class="kv-k">Dernière synchro</span><span class="kv-v">'+esc(agoText(c.lastSyncAt))+'</span></div>'
     +toggleHTML('Synchro auto à l’ouverture',c.auto!==false,'sync-toggle-auto')
     +'<button class="btn btn--ghost btn--block" data-act="sync-now" style="margin-top:8px">'+ic('refresh')+'Synchroniser maintenant</button>'
     +'<div class="btn-row" style="margin-top:8px"><button class="btn btn--ghost" data-act="sync-setup">'+ic('key')+'Changer le jeton</button>'
     +'<button class="btn btn--ghost" data-act="sync-disable">'+ic('ban')+'Désactiver</button></div>'
     +(c.gistId?'<div class="hint" style="margin-top:10px">gist : <span class="code-box" style="display:inline-block;padding:2px 6px">'+esc(c.gistId)+'</span><br>Ne partage jamais ce lien : un gist « secret » est introuvable sans son adresse, mais il n’est pas chiffré.</div>':'')
     +'</div>';
  } else {
    h+='<div class="card"><div class="row-title flex aic gap8">'+ic('cloud','ic--sm')+'Sauvegarde automatique</div>'
     +'<div class="small muted" style="margin:6px 0 12px">Tes chiffres se copient tout seuls chez GitHub à chaque ouverture. Gratuit, aucun nouveau compte, cinq minutes à régler.</div>'
     +'<button class="btn btn--primary btn--block" data-act="sync-setup">Activer la sauvegarde cloud</button></div>';
  }

  h+='<div class="section-title">Récupérer</div><div class="card">'
   +'<input type="file" id="importFile" accept=".json,.txt,application/json,text/plain" style="display:none">'
   +'<button class="btn btn--ghost btn--block" data-act="bk-import-file">'+ic('archive')+'Importer depuis un fichier</button>'
   +'<button class="btn btn--ghost btn--block" data-act="bk-import-paste" style="margin-top:8px">'+ic('table')+'Coller le texte d’une sauvegarde</button>'
   +(syncOn()?'<button class="btn btn--ghost btn--block" data-act="sync-pull" style="margin-top:8px">'+ic('cloud')+'Récupérer la copie cloud</button>':'')
   +'</div>';

  const rp=restorePoints();
  h+='<div class="section-title">Points de restauration sur cet iPhone</div>';
  if(!rp.length) h+='<div class="card"><div class="small muted">Aucun point de restauration pour l’instant.</div></div>';
  else h+='<div class="list">'+rp.map(r=>'<div class="row" data-act="bk-restore" data-key="'+r.key+'">'
    +'<div class="row-ic">'+ic(r.key===K_PREV?'history':'clock')+'</div>'
    +'<div class="row-main"><div class="row-title">'+esc(r.label)+'</div>'
    +'<div class="row-sub">'+esc(r.sub)+' · '+esc(fmtDateTime(r.at))+' · '+((r.counts&&r.counts.entries)||0)+' pesées</div></div>'+arrowHTML()+'</div>').join('')+'</div>';

  h+='<div class="card" style="margin-top:14px"><div class="row-title flex aic gap8">'+ic('phone','ic--sm')+'Je change de téléphone</div>'
   +'<div class="small muted" style="margin:6px 0 10px">Le guide en huit étapes pour ne rien perdre.</div>'
   +'<button class="btn btn--ghost btn--block" data-act="bk-phone-guide">Voir le guide</button></div>';
  h+='<div class="card"><div class="small muted">Où sont mes données ? Sur cet iPhone uniquement. Élan n’a pas de serveur, personne d’autre ne les voit. Espace utilisé : '+storageUsedText()+'.</div></div>';
  h+='<button class="btn btn--danger btn--block" data-act="bk-wipe" style="margin-top:14px">'+ic('trash')+'Tout effacer</button>';
  return h;
}

/* @@SECTION:ECRANS@@ */

/* ---------- Composants réutilisables ---------- */
function head(title,rightHTML){ return '<div class="screen-head"><h1 class="screen-title">'+esc(title)+'</h1>'+(rightHTML||'')+'</div>'; }
function backHead(title,back,rightHTML){ return '<a class="back-btn" href="#'+back+'"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Retour</a>'+head(title,rightHTML); }
function empty(icon,title,text,btn){ return '<div class="empty"><div class="empty-ic">'+ic(icon)+'</div><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p>'+(btn||'')+'</div>'; }
function sectionTitle(t,rightHTML){ return rightHTML
  ? '<div class="flex between aic" style="margin:22px 4px 10px"><div class="section-title" style="margin:0">'+esc(t)+'</div>'+rightHTML+'</div>'
  : '<div class="section-title">'+esc(t)+'</div>'; }
function statCard(label,val,sub,cls){ return '<div class="stat"><div class="stat-label">'+esc(label)+'</div>'
  +'<div class="stat-val '+(cls||'')+'">'+val+'</div>'+(sub?'<div class="stat-sub">'+sub+'</div>':'')+'</div>'; }
function ringHTML(pct,opts){ opts=opts||{}; const size=opts.size||76,stroke=opts.stroke||8,color=opts.color||'var(--acc)',R=(size-stroke)/2;
  return '<div class="goal-ring" style="width:'+size+'px;height:'+size+'px"><svg width="'+size+'" height="'+size+'" class="ring" viewBox="0 0 '+size+' '+size+'">'
    +'<circle class="ring-track" cx="'+size/2+'" cy="'+size/2+'" r="'+R+'" stroke-width="'+stroke+'"/>'
    +'<circle class="ring-fill" data-ring="'+pct+'" cx="'+size/2+'" cy="'+size/2+'" r="'+R+'" stroke-width="'+stroke+'" style="stroke:'+color+'"/></svg>'
    +(opts.center?'<div class="ring-center">'+opts.center+'</div>':'')+'</div>'; }
function segHTML(opts,active,act,extraCls,extraData){ return '<div class="seg'+(extraCls?' '+extraCls:'')+'">'+opts.map(o=>
  '<button class="seg-opt'+(String(o[0])===String(active)?' is-active':'')+'" data-act="'+act+'" data-val="'+esc(o[0])+'"'+(extraData||'')+'>'+esc(o[1])+'</button>').join('')+'</div>'; }
function chipsHTML(opts,active,act,extraData){ return '<div class="chip-row">'+opts.map(o=>
  '<button class="chip'+(String(o[0])===String(active)?' is-active':'')+'" data-act="'+act+'" data-val="'+esc(o[0])+'"'+(extraData||'')+'>'+(o[2]?o[2]+' ':'')+esc(o[1])+'</button>').join('')+'</div>'; }
function toggleHTML(label,on,act,dataAttrs,sub){ return '<div class="toggle"><div class="grow"><div class="toggle-label">'+esc(label)+'</div>'
  +(sub?'<div class="toggle-sub">'+esc(sub)+'</div>':'')+'</div>'
  +'<button class="switch'+(on?' on':'')+'" data-act="'+act+'"'+(dataAttrs||'')+' aria-label="'+esc(label)+'"></button></div>'; }
function arrowHTML(){ return '<div class="row-arrow"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>'; }
/* Une seule convention dans toute l'app : vert quand ça va dans le bon sens, GRIS sinon.
   Jamais d'orange ni de rouge sur une variation du corps, sur aucun écran. */
function signCls(delta,better){
  if(delta==null||delta===0||(better!=='down'&&better!=='up')) return 'delta--flat';
  return deltaClass(delta,better==='up'?1:-1);
}

/* ============================================================
   FEUILLES (SHEETS)
   ============================================================ */
const sheetRoot=document.getElementById('sheet-root');
let SHEET_CLOSE=null;
function sheetOpen(){ return sheetRoot.classList.contains('open'); }
function fitSheetToViewport(){
  const vv=window.visualViewport; if(!vv) return;
  const st=sheetRoot.style;
  if(!sheetOpen()){ st.top=st.bottom=st.height=''; return; }
  st.top=vv.offsetTop+'px'; st.bottom='auto'; st.height=vv.height+'px';
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',fitSheetToViewport);
  window.visualViewport.addEventListener('scroll',fitSheetToViewport);
  /* Après le recalage, le champ qui vient de prendre le focus peut se retrouver hors
     de la bande visible : on le ramène au centre une fois le clavier posé. */
  sheetRoot.addEventListener('focusin',e=>{
    const el=e.target; if(!el||!el.matches||!el.matches('input,textarea,select')) return;
    setTimeout(()=>{ try{ el.scrollIntoView({block:'center',behavior:motionOff()?'auto':'smooth'}); }catch(x){} },280);
  });
}
function openSheet(title,bodyHTML,opts){ opts=opts||{};
  SHEET_CLOSE=opts.onClose||null;
  sheetRoot.innerHTML='<div class="sheet-scrim" data-act="close-sheet"></div><div class="sheet"><div class="sheet-handle"></div>'
    +'<div class="sheet-head"><div class="sheet-title">'+esc(title)+'</div><button class="sheet-close" data-act="close-sheet" aria-label="Fermer">'+ic('close','ic--sm')+'</button></div>'
    +'<div class="sheet-body">'+bodyHTML+'</div></div>';
  sheetRoot.classList.add('open'); sheetRoot.setAttribute('aria-hidden','false');
  wireSheetDrag();
  fitSheetToViewport();
  if(opts.onOpen) opts.onOpen();
}
function closeSheet(){
  const cb=SHEET_CLOSE; SHEET_CLOSE=null;
  sheetRoot.classList.remove('open'); sheetRoot.setAttribute('aria-hidden','true');
  setTimeout(()=>{ if(!sheetRoot.classList.contains('open')){ sheetRoot.innerHTML=''; fitSheetToViewport(); } },350);
  if(cb) cb();
}
function refreshSheet(bodyHTML){ const b=q('.sheet-body',sheetRoot); if(b) b.innerHTML=bodyHTML; }
function setSheetTitle(t){ const el=q('.sheet-title',sheetRoot); if(el) el.textContent=t; }
function wireSheetDrag(){ const sheet=q('.sheet',sheetRoot); if(!sheet) return;
  const grips=[q('.sheet-handle',sheetRoot),q('.sheet-head',sheetRoot)]; let sy=0,dy=0,drag=false;
  const start=e=>{ drag=true; sy=e.touches[0].clientY; dy=0; sheet.style.transition='none'; };
  const move=e=>{ if(!drag) return; dy=Math.max(0,e.touches[0].clientY-sy); sheet.style.transform='translateY('+dy+'px)'; };
  const end=()=>{ if(!drag) return; drag=false; sheet.style.transition=''; if(dy>110){ closeSheet(); } else { sheet.style.transform=''; } };
  grips.forEach(g=>{ if(!g) return; g.addEventListener('touchstart',start,{passive:true}); g.addEventListener('touchmove',move,{passive:true});
    g.addEventListener('touchend',end); g.addEventListener('touchcancel',end); }); }
function confirmSheet(title,msg,onYes,danger,yesLabel,onNo){
  openSheet(title,'<p class="muted" style="margin:2px 0 18px;font-size:14.5px;line-height:1.5">'+esc(msg)+'</p>'
    +'<button class="btn '+(danger?'btn--danger':'btn--primary')+' btn--block" id="cfYes">'+esc(yesLabel||'Confirmer')+'</button>'
    +'<button class="btn btn--ghost btn--block" data-act="close-sheet" style="margin-top:8px">Annuler</button>',
    {onClose:onNo||null});
  const b=document.getElementById('cfYes');
  if(b) b.addEventListener('click',()=>{ SHEET_CLOSE=null; closeSheet(); setTimeout(onYes,80); }); }
function markActive(el){ const row=el.parentElement; qa('.chip',row).forEach(c=>c.classList.remove('is-active')); el.classList.add('is-active'); }
function segActivate(el){ const seg=el.parentElement; qa('.seg-opt',seg).forEach(c=>c.classList.remove('is-active')); el.classList.add('is-active'); }

/* ============================================================
   ANIMATIONS & TOAST
   ============================================================ */
function countUp(el,to,dec,animate){
  const d=dec==null?1:dec;
  if(animate===false||motionOff()||!isNum(to)){ el.textContent=isNum(to)?nf(to,d):'—'; return; }
  const dur=750,start=performance.now(),from=0,ease=t=>1-Math.pow(2,-10*t);
  function frame(now){ let t=Math.min(1,(now-start)/dur); if(t>=1){ el.textContent=nf(to,d); return; }
    el.textContent=nf(from+(to-from)*ease(t),d); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
}
function setRing(el){ const pct=clamp(parseFloat(el.dataset.ring)||0,0,1); const R=el.r.baseVal.value; const c=2*Math.PI*R;
  el.style.strokeDasharray=c; el.style.strokeDashoffset=motionOff()?c*(1-pct):c;
  if(!motionOff()) requestAnimationFrame(()=>requestAnimationFrame(()=>{ el.style.strokeDashoffset=c*(1-pct); })); }
const fx=document.getElementById('fx'); let fxCtx=null;
function fxResize(){ if(!fx) return; fx.width=innerWidth; fx.height=innerHeight; }
function confetti(){ if(motionOff()||!fx) return; fxResize(); fxCtx=fx.getContext('2d');
  const cols=['#3DD68C','#7BF0BA','#5AC8FA','#A78BFA','#F5C56B']; const P=[];
  for(let i=0;i<90;i++) P.push({x:innerWidth/2+(Math.random()-.5)*120,y:innerHeight*0.4,vx:(Math.random()-.5)*10,vy:-Math.random()*12-4,
    c:cols[i%cols.length],s:5+Math.random()*5,r:Math.random()*6,vr:(Math.random()-.5)*.4});
  let f=0; (function anim(){ f++; fxCtx.clearRect(0,0,fx.width,fx.height);
    P.forEach(p=>{ p.vy+=.4; p.x+=p.vx; p.y+=p.vy; p.r+=p.vr; fxCtx.save(); fxCtx.translate(p.x,p.y); fxCtx.rotate(p.r);
      fxCtx.fillStyle=p.c; fxCtx.fillRect(-p.s/2,-p.s/2,p.s,p.s); fxCtx.restore(); });
    if(f<110) requestAnimationFrame(anim); else fxCtx.clearRect(0,0,fx.width,fx.height); })(); }

let toastTimer=null;
function toast(msg,undoFn){ const root=document.getElementById('toast-root'); if(!root) return;
  const el=document.createElement('div'); el.className='toast';
  el.innerHTML='<span class="toast-msg">'+esc(msg)+'</span>'+(undoFn?'<button class="toast-undo">Annuler</button>':'');
  root.innerHTML=''; root.appendChild(el);
  if(undoFn) el.querySelector('.toast-undo').addEventListener('click',()=>{ undoFn(); el.remove(); });
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ el.classList.add('hide'); setTimeout(()=>el.remove(),250); },undoFn?4200:2800);
}

/* ============================================================
   ACTIONS (délégation via data-act)
   ============================================================ */
const ACTIONS={
  'go':d=>nav(d.route),
  'close-sheet':()=>closeSheet(),
  'app-update':()=>{ haptic(); checkForUpdate(); },
  'wk-prev':()=>{ const f=firstEntry();
    const p=addDayYMD(weekOfUI(),-7);
    if(f&&p<weekStartYMD(f.date)) return;
    state.ui.weekStart=p; haptic(); saveNow(); render(); },
  'wk-next':()=>{ const n=addDayYMD(weekOfUI(),7);
    if(n>weekStartYMD(isoToday())) return;
    state.ui.weekStart=n; haptic(); saveNow(); render(); },
  'wk-today':()=>{ state.ui.weekStart=null; haptic(); saveNow(); render(); },
  /* Les mensurations se saisissent dans la feuille de pesée, curseur sur la bonne case :
     un second formulaire pour les mêmes champs finirait par diverger de celui-ci. */
  'meas-add':d=>{ const k=d.k&&metricOn(d.k)?d.k:(TAPE_KEYS.filter(metricOn)[0]||'waist');
    openWeighIn(isoToday(),k); },
  'app-hard-refresh':()=>confirmSheet('Tout recharger ?',
    'Élan va vider son cache et se retélécharger. Tes pesées, tes séances, tes réglages et ta synchro ne sont pas concernés : ils vivent ailleurs et resteront intacts.',
    'Tout recharger',()=>hardRefresh()),
  'go-metrics':()=>{ const d=WI&&WI.date; closeSheet(); WI_RETOUR=d||null; nav('/metriques'); },
  'wi-resume':()=>{ const d=WI_RETOUR; WI_RETOUR=null; openWeighIn(d||isoToday()); },

  /* --- Saisie --- */
  'weigh-in':d=>openWeighIn(d&&d.date?d.date:isoToday()),
  'quick-kcal':d=>openQuickMetric('kcalIn',(d&&d.date)||isoToday()),
  'wi-kcal':d=>openWeighIn((d&&d.date)||isoToday(),'kcalIn'),
  'qm-day':d=>openQuickMetric(d.k,d.date),
  'qm-save':d=>saveQuickMetric(d.k,d.date),
  'wi-day':d=>wiSetDate(addDayYMD(isoToday(),parseInt(d.d,10))),
  'wi-save':()=>saveWeighIn(),
  'wi-delete':()=>deleteWeighIn(),
  'skip-today':()=>{ state.ui.skippedDays=state.ui.skippedDays||{}; state.ui.skippedDays[isoToday()]=1; update();
    toast('Journée sans pesée — à demain.',()=>{ delete state.ui.skippedDays[isoToday()]; update(); }); },
  'unskip-today':()=>{ delete (state.ui.skippedDays||{})[isoToday()]; update(); openWeighIn(isoToday()); },
  'toggle-hero':()=>{ state.settings.heroMode=(state.settings.heroMode==='trend')?'raw':'trend'; touch(); saveNow(); render(); },

  /* --- Objectif, paliers, motivations --- */
  'edit-goal':()=>goalEditor(),
  'goal-preset':(d,el)=>{ const i=document.getElementById('gWeight'); if(i){ i.value=nf(parseFloat(d.v),1); markActive(el);
    const hint=document.getElementById('gHint'); const b=bmiOf(parseFloat(d.v));
    if(hint&&b!=null) hint.textContent='IMC visé : '+nf(b,1)+' — '+bmiCat(b).toLowerCase(); } },
  'goal-save':()=>saveGoal(),
  'goal-clear':()=>{ state.settings.goal.weightKg=null; state.settings.goal.date=null; closeSheet(); update(); toast('Objectif retiré'); },
  'set-maintain':()=>{ const t=trendNow(); if(t==null) return;
    state.settings.goal.weightKg=Math.round(t*10)/10; state.settings.goal.mode='maintain'; update(); toast('Mode maintien activé'); },
  'edit-start':()=>startEditor(),
  'start-save':()=>{ const d=(document.getElementById('soDate')||{}).value, k=parseNum((document.getElementById('soKg')||{}).value);
    if(!validYMD(d)||k==null){ toast('Date et poids requis'); return; }
    state.settings.startOverride={date:d,weightKg:Math.round(k*10)/10}; closeSheet(); update(); toast('Point de départ enregistré'); },
  'start-clear':()=>{ state.settings.startOverride=null; closeSheet(); update(); toast('Retour au calcul automatique'); },
  'add-motivation':()=>motivationEditor(null),
  'edit-motivation':d=>motivationEditor(d.id),
  'mv-emoji':(d,el)=>markActive(el),
  'save-motivation':d=>{
    const t=String((document.getElementById('mvText')||{}).value||'').trim();
    if(!t){ toast('Écris quelque chose'); return; }
    const chip=q('#sheet-root .chip.is-active[data-emoji]');
    const em=chip?chip.dataset.emoji:'💭';
    if(d.id){ const m=state.motivations.find(x=>x.id===d.id); if(m){ m.text=t; m.emoji=em; } }
    else state.motivations.push({id:uid(),text:t,emoji:em,active:true,createdAt:new Date().toISOString()});
    closeSheet(); update(); toast('C’est noté'); },
  'del-motivation':d=>{ const i=state.motivations.findIndex(x=>x.id===d.id); if(i<0) return;
    const m=state.motivations[i]; state.motivations.splice(i,1); closeSheet(); update();
    toast('Supprimé',()=>{ state.motivations.splice(i,0,m); update(); }); },

  /* --- Courbes --- */
  /* --- Simulateur --- */
  'sim-delta':d=>{ state.ui.simIntake=clamp(simIntake()+parseInt(d.d,10),800,6000); saveNow(); render(); },
  'sim-set':d=>{ state.ui.simIntake=clamp(parseInt(d.v,10)||2000,800,6000); saveNow(); render(); },

  'ch-view':d=>{ CH().view=d.v; saveNow(); render(); },
  'ch-period':(d,el)=>{ CH().period=el.dataset.val; saveNow(); render(); },
  'ch-metric':d=>{ CH().metric=d.m; saveNow(); render(); },
  'ch-unit':(d,el)=>{ state.settings.metricUnitPref[CH().metric]=el.dataset.val; touch(); save(); render(); },
  'ch-toggle':d=>{ CH()[d.k]=!CH()[d.k]; saveNow(); render(); },
  'ch-caloverlay':d=>{ CH().calOverlay=d.v; saveNow(); render(); },
  'ch-lag':(d,el)=>{ CH().lag=clamp(parseInt(d.val!=null?d.val:el.dataset.val,10)||2,1,XC_MAX_LAG); saveNow(); render(); },
  'hm-weigh':d=>openWeighIn(d.date),
  'hm-sport':d=>openSportDaySheet(d.date),

  /* --- Tableau --- */
  'tbl-toggle':d=>{ TBL()[d.k]=!TBL()[d.k]; saveNow(); render(); },
  'tbl-more':()=>{ TBL().limit+=200; render(); },
  'tbl-row':d=>{ if(TBL().del) return; openWeighIn(d.date); },
  'tbl-del':d=>{
    const e=entryFor(d.date); if(!e) return;
    const i=state.entries.indexOf(e);
    confirmSheet('Supprimer la pesée','La pesée du '+fmtDateLong(d.date)+' sera supprimée. Continuer ?',()=>{
      state.entries.splice(i,1); update();
      toast('Pesée supprimée',()=>{ state.entries.splice(i,0,e); update(); });
    },true,'Supprimer'); },
  'tbl-csv':()=>exportCSV(),
  'tbl-gap':d=>{
    const from=d.from,to=d.to, list=[];
    for(let x=addDayYMD(from,1);x<to;x=addDayYMD(x,1)) if(!entryFor(x)) list.push(x);
    openSheet('Jours sans pesée','<div class="small muted" style="margin-bottom:10px">Si tu as encore les chiffres, tu peux les ajouter.</div>'
      +'<div class="chip-wrap">'+list.slice(0,30).map(x=>'<button class="chip chip--act" data-act="weigh-in" data-date="'+x+'">'
      +esc(capit(parseYMD(x).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})))+'</button>').join('')+'</div>'); },

  /* --- Modules & réglages --- */
  'mod-on':d=>{ setModule(d.k,true); },
  'mod-toggle':(d,el)=>{ setModule(d.k,!state.settings.modules[d.k]); },
  'metric-on':d=>{ state.settings.metrics[d.k]=true; touch(); invalidateCache(); save(); render();
    toast(METRICS[d.k].label+' activé — tu le trouveras dans ta pesée'); },
  'metric-toggle':(d,el)=>{ state.settings.metrics[d.k]=!metricOn(d.k); el.classList.toggle('on'); touch(); invalidateCache(); save(); },
  'bone-unit':(d,el)=>{ state.settings.metricUnitPref.bone=el.dataset.val; segActivate(el); touch(); invalidateCache(); save(); render(); },
  'st-sex':(d,el)=>{ state.settings.profile.sex=el.dataset.val; segActivate(el); touch(); invalidateCache(); save(); },
  'st-job':d=>{ state.settings.profile.job=d.k; touch(); invalidateCache(); save(); render(); },
  'st-tab':d=>{
    const cur=tabList().slice(), i=cur.indexOf(d.r);
    if(i>=0){
      if(tabChoice(d.r).fixed){ toast('Cet onglet ne peut pas être retiré'); return; }
      if(cur.length<=3){ toast('Il faut au moins trois onglets'); return; }
      cur.splice(i,1);
    } else {
      if(cur.length>=6){ toast('Six onglets au maximum — retires-en un d’abord'); return; }
      cur.splice(cur.indexOf('/plus'),0,d.r);          // les raccourcis se rangent avant « Plus »
    }
    state.settings.tabs=cur; touch(); save(); renderTabbar(); render(); },
  'st-accent':(d,el)=>{ state.settings.accentTheme=el.dataset.val; touch(); save(); applyAccent(); render(); },
  'st-first':(d,el)=>{ state.settings.firstScreen=el.dataset.val; segActivate(el); touch(); save(); },
  'st-density':(d,el)=>{ state.settings.density=el.dataset.val; touch(); save(); applyPrefs(); render(); },
  'st-kcalmode':(d,el)=>{ state.settings.sport.kcalMode=el.dataset.val; segActivate(el); touch(); save(); },
  'st-toggle':d=>{
    const s=state.settings, k=d.k;
    if(k==='reduceMotion') s.reduceMotion=(s.reduceMotion===true)?null:true;   // null = suit le réglage du système
    else if(k==='numberPrivacy') s.numberPrivacy=!s.numberPrivacy;             // défaut : éteint
    else s[k]=(s[k]===false);                                                  // défaut : allumé (tout sauf false)
    touch(); save(); applyPrefs(); render(); },
  'pillset-toggle':(d,el)=>{ state.settings.pillbox[d.k]=!state.settings.pillbox[d.k]; el.classList.toggle('on'); touch(); save(); },

  /* --- Sport --- */
  'new-session':d=>openSessionSheet({date:(d&&d.date)||isoToday()}),
  'edit-session':d=>openSessionSheet({id:d.id}),
  'save-session':()=>saveSession(),
  'delete-session':d=>deleteSession(d.id),
  'ss-act':d=>{ SS.activityKey=d.key; const a=actByKey(d.key);
    if(a&&!SS.durTouched){ SS.durationMin=a.defaultDurationMin||SS.durationMin; SS.intensity=a.defaultIntensity||SS.intensity; }
    refreshSheet(sessionSheetBody()); },
  'ss-act-all':()=>{ SS.showAll=!SS.showAll; refreshSheet(sessionSheetBody()); },
  'ss-dur':d=>{ SS.durationMin=clamp(SS.durationMin+parseInt(d.delta,10),5,600); SS.durTouched=true; ssRefreshDur(); },
  'ss-dur-set':(d,el)=>{ SS.durationMin=parseInt(d.min,10); SS.durTouched=true; markActive(el); ssRefreshDur(); },
  'ss-int':(d,el)=>{ SS.intensity=el.dataset.val; segActivate(el); ssRefreshDur(); },
  'ss-more':()=>{ SS.showMore=!SS.showMore; const b=document.getElementById('ssMore'); if(b) b.style.display=SS.showMore?'':'none'; },
  'ss-date':(d,el)=>{ SS.date=addDayYMD(isoToday(),parseInt(d.d,10)); markActive(el);
    const i=document.getElementById('ssDate'); if(i) i.value=SS.date; ssRefreshDur(); },
  'sport-period':(d,el)=>{ const v=el.dataset.val; state.ui.sportPeriod=(v==='year')?'year':parseInt(v,10); saveNow(); render(); },
  'sport-month':d=>{ const cur=state.ui.sportMonth||monthKey(isoToday());
    const next=monthKey(addMonthsYMD(cur+'-01',parseInt(d.d,10)));
    if(next>monthKey(isoToday())) return;                 // pas de calendrier dans le futur
    state.ui.sportMonth=next; render(); },
  'sport-month-today':()=>{ state.ui.sportMonth=null; render(); },
  'sport-day':d=>openSportDaySheet(d.date),
  'edit-weekly-goal':()=>weeklyGoalSheet(),
  'wg-preset':(d,el)=>{ const i=document.getElementById('wgMin'); if(i){ i.value=d.m; markActive(el); } },
  'wg-save':()=>{ const g=x=>{ const el=document.getElementById(x); return el?el.value:''; };
    state.settings.sport.weeklyGoalMin=Math.max(0,parseInt(g('wgMin'),10)||0);
    state.settings.sport.weeklyGoalSessions=Math.max(0,parseInt(g('wgSes'),10)||0);
    closeSheet(); update(); toast('Objectif enregistré ✓'); },
  'new-activity':()=>activityEditor(null),
  'edit-activity':d=>activityEditor(d.key),
  'ac-int':(d,el)=>{ AF.defaultIntensity=el.dataset.val; segActivate(el); },
  'ac-dist':(d,el)=>{ AF.tracksDistance=!AF.tracksDistance; el.classList.toggle('on'); },
  'ac-save':()=>saveActivity(),
  'ac-archive':d=>{ const a=actByKey(d.key); if(!a) return; a.archived=!a.archived; closeSheet(); update();
    toast(a.archived?'Activité masquée':'Activité réaffichée'); },

  /* --- Planning --- */
  'new-plan':()=>planEditor(null),
  'edit-plan':d=>planEditor(d.id),
  'pf-kind':(d,el)=>{ PF.kind=el.dataset.val; refreshSheet(planEditorBody()); },
  'pf-act':d=>{ PF.activityKey=d.key; refreshSheet(planEditorBody()); },
  'pf-dow':(d,el)=>{ const n=parseInt(d.n,10); const i=PF.weekdays.indexOf(n);
    if(i<0) PF.weekdays.push(n); else PF.weekdays.splice(i,1); el.classList.toggle('is-active'); },
  'pf-every':(d,el)=>{ PF.everyNWeeks=parseInt(el.dataset.val,10)||1; segActivate(el); },
  'pf-save':()=>savePlan(),
  'pf-del':d=>deletePlan(d.id),
  'plan-done':d=>{
    const day=String(d.key).split('|')[2]||isoToday();
    const occ=planOccurrences(day,day).find(o=>o.key===d.key);
    if(!occ){ setPlanOcc(d.key,'done',null); update(); toast('Noté — c’est fait ✓'); return; }
    openSessionSheet({date:occ.date,activityKey:occ.activityKey,durationMin:occ.durationMin,planKey:occ.key}); },
  'plan-skip':d=>{ setPlanOcc(d.key,'skipped',null); update();
    toast('Noté — pas cette fois',()=>{ clearPlanOcc(d.key); update(); }); },

  /* --- Pilulier --- */
  'pill-tab':d=>{ state.ui.pillTab=d.t; render(); },
  'pill-day':d=>{ state.ui.pillDate=addDayYMD(pillCtxDate(),parseInt(d.d,10)); state.ui.pillDateSetOn=pillToday(); render(); },
  'pill-week':d=>{ state.ui.pillWeek=addDayYMD(state.ui.pillWeek||weekStartYMD(pillToday()),parseInt(d.d,10)); render(); },
  'pill-goto-day':d=>{ state.ui.pillTab='jour'; state.ui.pillDate=d.date; state.ui.pillDateSetOn=pillToday(); render(); },
  'pill-open':d=>{ const s=pillSlotByKey(d.key); if(s) pillTakeSheet(s); },
  'pill-take':d=>{ const s=pillSlotByKey(d.key); if(s) pillTake(s,{}); },
  'pill-skip':d=>{ const key=d.key||(PILL_TAKE&&PILL_TAKE.key); const s=pillSlotByKey(key); if(s){ closeSheet(); pillSkip(s); } },
  'pill-later':d=>{ PILL_TAKE={key:d.key}; openSheet('Plus tard',pillLaterBody()); },
  'pill-later-menu':()=>refreshSheet(pillLaterBody()),
  'pill-snooze':d=>{ const s=pillSlotByKey(PILL_TAKE&&PILL_TAKE.key); if(s){ closeSheet(); pillSnooze(s,parseInt(d.m,10)); } },
  'pill-anyway':d=>{ const s=pillSlotByKey(d.key); if(s) pillTake(s,{offPlan:true}); },
  'pill-confirm-take':()=>pillConfirmTakeFromSheet(),
  'pill-alt-choose':(d,el)=>{ PILL_TAKE.scheduleId=d.id; segActivate(el); },
  'pill-undo':d=>pillUndo(d.id),
  'pill-free':()=>pillFreeIntakeSheet(),
  'pill-save-free':()=>pillSaveFreeIntake(),
  'pill-new-product':()=>pillProductEditor(null),
  'pill-edit-product':d=>pillProductEditor(d.id),
  'pill-save-product':d=>savePillProduct(d.id||null),
  'pill-del-product':d=>deletePillProduct(d.id),
  'pill-pause-product':d=>{ const p=medById(d.id); if(!p) return; p.active=!p.active; update(); toast(p.active?'Reprise':'Mis en pause'); },
  'pill-kind':(d,el)=>{ PILL_FORM.kind=el.dataset.val; segActivate(el);
    const ic=document.getElementById('mIcon'); if(ic&&!ic.dataset.touched) ic.value=medKindIcon(PILL_FORM.kind); },
  'pill-new-sched':d=>pillScheduleEditor(d.pid,null),
  'pill-edit-sched':d=>{ closeSheet(); setTimeout(()=>pillScheduleEditor(null,d.id),150); },
  'pill-save-sched':d=>savePillSchedule(d.pid,d.id||null),
  'pill-del-sched':d=>deletePillSchedule(d.id),
  'pill-anchor':(d,el)=>{ PILL_SF.anchor.type=el.dataset.val; segActivate(el); refreshSheet(pillSchedBody()); },
  'pill-moment':(d,el)=>{ PILL_SF.anchor.moment=d.m; markActive(el); },
  'pill-dir':(d,el)=>{ PILL_SF.anchor.dir=el.dataset.val; segActivate(el); },
  'pill-rec':(d,el)=>{ PILL_SF.recurrence.type=el.dataset.val; segActivate(el); refreshSheet(pillSchedBody()); },
  'pill-dow':(d,el)=>{ const n=parseInt(d.n,10); const a=PILL_SF.recurrence.days=PILL_SF.recurrence.days||[];
    const i=a.indexOf(n); if(i<0) a.push(n); else a.splice(i,1); el.classList.toggle('is-active'); },
  'pill-group-new':d=>pillGroupEditor(d.pid,null),
  'pill-group-edit':d=>pillGroupEditor(null,d.id),
  'pill-group-save':d=>savePillGroup(d.pid,d.id||null),
  'pill-group-del':d=>deletePillGroup(d.id),
  'pill-alt-toggle':(d,el)=>el.classList.toggle('on'),
  'pill-ics-all':()=>pillDownloadIcsAll(),

  /* --- Sauvegarde --- */
  'bk-share':()=>shareBackup(),
  'bk-download':()=>downloadBackup(),
  'bk-copy':()=>copyBackup(),
  'bk-snooze':()=>{ state.ui.backupSnoozeUntil=addDayYMD(isoToday(),3); saveNow(); render(); },
  'bk-import-file':()=>{ const f=document.getElementById('importFile'); if(f) f.click(); },
  'bk-import-paste':()=>openSheet('Coller une sauvegarde',
    '<div class="field"><label>Colle ici le texte de ta sauvegarde</label>'
    +'<textarea class="input" id="pasteArea" style="min-height:170px" placeholder="{ &quot;_app&quot;: &quot;Elan&quot;, … }"></textarea></div>'
    +'<button class="btn btn--primary btn--block" data-act="bk-parse-paste">Analyser</button>'),
  'bk-parse-paste':()=>{ const el=document.getElementById('pasteArea'); if(!el) return;
    const r=parseBackup(el.value); if(r.error){ toast(r.error); return; } showImportPreview(r); },
  'imp-settings':(d,el)=>el.classList.toggle('on'),
  'bk-do-import':d=>{ if(!IMPORT_STAGE) return;
    const data=IMPORT_STAGE.data;
    const sw=document.getElementById('impSettings');
    const withSettings=!!(sw&&sw.classList.contains('on'));
    if(d.mode==='replace'){ closeSheet(); confirmSheet('Tout remplacer',
      'Toutes tes données actuelles seront remplacées. Un filet de sécurité est gardé sur cet appareil. Continuer ?',
      ()=>applyImport(data,'replace',true),true,'Tout remplacer'); }
    else applyImport(data,'merge',withSettings); },
  'bk-restore':d=>restoreFrom(d.key),
  'bk-phone-guide':()=>openSheet('Je change de téléphone',phoneGuideHTML()),
  'bk-wipe':()=>confirmSheet('Tout effacer',
    'Toutes tes données seront supprimées de cet appareil. Un filet de sécurité est gardé, mais la seule vraie protection est une sauvegarde exportée. Continuer ?',
    ()=>{ snapshotPrev('avant effacement total'); LOAD_ERROR=null; state=migrate(defaultDB()); invalidateCache(); saveNow(); nav('/'); render(); toast('Tout a été effacé'); },true,'Tout effacer'),
  'sync-setup':()=>openSheet('Sauvegarde cloud',syncSetupHTML()),
  'sync-save-token':()=>saveTokenAndInit(),
  'sync-now':()=>syncNow(true),
  'sync-toggle-auto':(d,el)=>{ const c=syncCfg(); c.auto=!c.auto; saveSyncCfg(c); el.classList.toggle('on'); },
  'sync-link':()=>openSheet('Relier une copie existante',linkGistHTML()),
  'sync-link-save':()=>{ const el=document.getElementById('gistId'); const id=((el&&el.value)||'').trim();
    if(!id){ toast('Colle l’identifiant du gist'); return; }
    const c=syncCfg(); c.gistId=id; c.status='ok'; saveSyncCfg(c); closeSheet(); syncNow(true); },
  'sync-disable':()=>confirmSheet('Désactiver la synchro',
    'La copie déjà présente sur GitHub ne sera pas supprimée, mais Élan ne la mettra plus à jour. Le jeton sera effacé de cet iPhone.',
    ()=>{ try{ localStorage.removeItem(K_SYNC); }catch(e){} render(); toast('Synchro désactivée'); }),
  'sync-pull':()=>cloudRead().then(r=>confirmSheet('Récupérer la copie cloud',
      'Remplacer les données de cet iPhone par la copie cloud ('+((r.counts&&r.counts.entries)||0)+' pesées) ? Un filet de sécurité est gardé.',
      ()=>cloudPull(r),true,'Récupérer')).catch(e=>handleSyncError(e,true)),
  'sync-resolve':async d=>{
    const r=SYNC_REMOTE; if(!r) return; closeSheet();
    try{
      if(d.how==='merge'){ snapshotPrev('avant fusion cloud');
        COLLECTIONS.forEach(c=>{ state[c.key]=mergeCollection(c,state[c.key]||[],r.data[c.key]||[]); });
        const rui=r.data.ui||{};
        state.ui.skippedDays=Object.assign({},state.ui.skippedDays||{},rui.skippedDays||{});
        state=migrate(state); touch(); invalidateCache(); saveNow(); await cloudPush(); render(); toast('Fusionné et synchronisé ✓'); }
      else if(d.how==='local'){
        const localN=(state.entries||[]).length, remoteN=((r.counts&&r.counts.entries)|0);
        if(remoteN>0&&localN<remoteN){
          confirmSheet('Remplacer la copie cloud',
            'La copie cloud contient '+remoteN+' '+plural(remoteN,'pesée')+', cet iPhone en a '+localN+'. Elle sera remplacée par celle-ci. Continuer ?',
            async()=>{ try{ touch(); await cloudPush(); toast('Cloud mis à jour depuis cet iPhone ✓'); }catch(e2){ handleSyncError(e2,true); } },
            true,'Remplacer');
          return;
        }
        touch(); await cloudPush(); toast('Cloud mis à jour depuis cet iPhone ✓');
      }
      else if(d.how==='cloud'){ await cloudPull(r); toast('Version cloud restaurée ✓'); }
    }catch(e){ handleSyncError(e,true); } },

  /* --- Onboarding --- */
  'onboard-save':()=>{
    const g=x=>{ const el=document.getElementById(x); return el?el.value:''; };
    const hCm=parseNum(g('obHeight')), w=parseNum(g('obWeight')), tg=parseNum(g('obTarget'));
    const why=String(g('obWhy')||'').trim();
    if(!(hCm>=120&&hCm<=230)){ toast('Ta taille en centimètres ? (ex. 182)'); return; }
    if(!(w>=30&&w<=350)){ toast('Et ton poids du jour ? (ex. 110)'); return; }
    state.settings.profile.heightCm=Math.round(hCm);
    state.settings.goal.weightKg=(tg>=30&&tg<=350)?Math.round(tg*10)/10:Math.round(w*0.9*10)/10;
    const e=ensureEntry(isoToday());
    setMetric(e,'weight',Math.round(w*10)/10,'kg');
    if(why) state.motivations.push({id:uid(),text:why,emoji:'💭',active:true,createdAt:new Date().toISOString()});
    state.settings.onboardingDone=true;
    invalidateCache(); saveNow(); render();
    if(state.settings.celebrateOn!==false) confetti();
    toast('Bienvenue ! Première pesée enregistrée'); }
};
function setModule(k,on){
  const avaitPlanning=!!state.settings.modules.planning;
  state.settings.modules[k]=!!on;
  if(k==='sport'&&on&&!state.settings.sport.startedAt) state.settings.sport.startedAt=isoToday();
  if(k==='planning'&&on){ state.settings.modules.sport=true; if(!state.settings.planning.floorDate) state.settings.planning.floorDate=isoToday(); }
  if(k==='pillbox'&&on&&!state.settings.pillbox.floorDate) state.settings.pillbox.floorDate=isoToday();
  /* Les prévisions font partie du module Sport : elles se mettent en pause avec lui
     et reviennent telles quelles quand il revient. */
  if(k==='sport'&&!on){ state.settings.planningPaused=avaitPlanning; state.settings.modules.planning=false; }
  if(k==='sport'&&on&&state.settings.planningPaused){ state.settings.modules.planning=true; state.settings.planningPaused=false; }
  update();
  if(k==='sport'&&!on&&avaitPlanning) toast('Sport désactivé — les prévisions d’entraînement le sont aussi. Tes données sont conservées.');
  else toast(on?'Module activé ✓':'Module désactivé — tes données sont conservées');
}

/* ---------- Listeners globaux ---------- */
/* Un réglage porteur de `data-set` s'écrit tout seul quand on quitte le champ.
   Plus de bouton « Enregistrer » à ne pas oublier — donc plus de réglage perdu. */
function applySettingInput(el){
  const path=el.dataset.set; if(!path) return;
  const type=el.dataset.type||'text';
  let v=el.value;
  if(type==='int'||type==='num'){
    v=(type==='int')?parseInt(String(v).replace(/\s/g,''),10):parseNum(v);
    if(!isFinite(v)) v=null;
    if(v!=null){
      const mn=el.dataset.min!=null?parseFloat(el.dataset.min):null;
      const mx=el.dataset.max!=null?parseFloat(el.dataset.max):null;
      if(mn!=null&&v<mn) v=mn;
      if(mx!=null&&v>mx) v=mx;
      if(String(v)!==String(el.value).replace(/\s/g,'')) el.value=v;   // on montre la valeur retenue
    }
  } else if(type==='time'){ v=/^\d{1,2}:\d{2}$/.test(v)?v:null; }
  else { v=String(v).trim()||null; }
  const parts=path.split('.');
  let o=state.settings;
  for(let i=0;i<parts.length-1;i++){ if(!o[parts[i]]||typeof o[parts[i]]!=='object') o[parts[i]]={}; o=o[parts[i]]; }
  const last=parts[parts.length-1];
  if(v==null&&(type==='time'||el.dataset.keep==='1')) return;           // une heure vide ne doit rien casser
  o[last]=v;
  touch(); invalidateCache(); save();
  if(el.dataset.rerender==='1') render();
}
function onChange(e){
  if(e.target&&e.target.dataset&&e.target.dataset.set){ applySettingInput(e.target); return; }
  const id=e.target.id;
  if(id==='wiDate'&&WI){ wiSetDate(e.target.value); return; }
  if(id==='simRange'){ state.ui.simIntake=clamp(parseInt(e.target.value,10)||2000,800,6000); saveNow(); render(); return; }
  if(id==='tblRange'){ TBL().range=e.target.value; TBL().limit=TBL_PAGE; saveNow(); render(); return; }
  if(id==='tblSort'){ TBL().sort=e.target.value; saveNow(); render(); return; }
  if(id==='ssDate'&&SS){ SS.date=e.target.value; ssRefreshDur(); return; }
  if(id==='stPal'){ const v=e.target.value;
    if(v==='auto'){ state.settings.energy.palMode='auto'; } else { state.settings.energy.palMode='manual'; state.settings.energy.pal=v; }
    saveNow(); render(); return; }
  if(id==='sGroup'&&PILL_SF){ PILL_SF.groupId=e.target.value||null; return; }
  if(id==='sMeal'&&PILL_SF){ PILL_SF.anchor.meal=e.target.value; return; }
  if(id==='importFile'&&e.target.files&&e.target.files[0]){
    const fr=new FileReader();
    fr.onload=ev=>{ const res=parseBackup(String(ev.target.result)); if(res.error) toast(res.error); else showImportPreview(res); };
    fr.readAsText(e.target.files[0]); e.target.value=''; return;
  }
}
/* Le curseur du simulateur donne un retour immédiat pendant qu'on le fait glisser ;
   le recalcul complet n'a lieu qu'au relâchement. */
function simPreview(el){
  const v=clamp(parseInt(el.value,10)||2000,800,6000);
  const neutral=parseInt(el.dataset.neutral,10)||v, gap=v-neutral;
  const a=document.getElementById('simVal'); if(a) a.textContent=nf(v,0);
  const g=document.getElementById('simGap');
  if(g){ g.className='sim-gap '+(gap<0?'is-down':(gap>0?'is-up':''));
    g.innerHTML=Math.abs(gap)<25?'Tu es à l’équilibre : ton poids reste stable.'
      :(gap<0?'<b>'+nf(-gap,0)+' kcal</b> de moins que ton point neutre chaque jour.'
             :'<b>'+nf(gap,0)+' kcal</b> de plus que ton point neutre chaque jour.'); }
}
function onInput(e){
  const t=e.target;
  if(t.dataset&&t.dataset.mi&&WI){ wiInput(t); return; }
  if(t.id==='simRange'){ simPreview(t); return; }
  if(t.id==='mIcon'){ t.dataset.touched='1'; return; }
  if(t.id==='ssNote'&&SS){ SS.note=t.value; return; }
  if(t.id==='ssDist'&&SS){ SS.distanceKm=t.value; return; }
  if(t.id==='ssKcal'&&SS){ SS.kcalManual=t.value; SS.kcalTouched=true; return; }
  if(t.id==='wiNote'&&WI){ WI.note=t.value; return; }
  if(t.id==='obWeight'){
    const w=parseNum(t.value), el=document.getElementById('obHint');
    if(el&&w>30){ const tg=Math.round(w*0.9*10)/10, b=bmiOf(tg);
      el.textContent='Pas d’idée ? −10 % te mènerait à '+nf(tg,1)+' kg'+(b!=null?(' — soit un IMC de '+nf(b,1)+'.'):'.'); }
    return;
  }
  if(t.id==='gWeight'){
    const w=parseNum(t.value), el=document.getElementById('gHint'), b=w!=null?bmiOf(w):null;
    if(el) el.textContent=(b!=null)?('IMC visé : '+nf(b,1)+' — '+bmiCat(b).toLowerCase()):'';
    return;
  }
}
/* Câblages spécifiques à un écran, après chaque rendu. */
function postRenderScreen(r,animate){
  paintSyncBadge();
  if(r==='/'&&animate!==false) setTimeout(()=>checkMilestones({celebrate:true}),500);
}
/* ---------- Ouverture de l'app ---------- */
function onAppOpen(){
  state.meta.lastOpenAt=new Date().toISOString();
  state.meta.openCount=(state.meta.openCount|0)+1;
  checkMilestones({celebrate:false});
  autoBackupTick();
  try{ if(navigator.storage&&navigator.storage.persist&&weighIns().length>=3) navigator.storage.persist(); }catch(e){}
  saveNow();
}
/* Un seul rappel par jour, et seulement s'il apporte quelque chose que l'écran ne dit pas déjà. */
function bootNudge(){
  if(currentRoute()==='/') return;
  if(state.ui.lastNudgeDate===isoToday()) return;
  let msg=null;
  const late=pillLateToday();
  if(late.length===1) msg=late[0].product.name+' — prévu '+late[0].timeLabel;
  else if(late.length>1) msg=late.length+' prises en retard aujourd’hui';
  if(!msg&&state.settings.modules.planning&&state.settings.planning.remindOnBoot){
    const p=plannedToday().filter(o=>o.status==='undecided');
    if(p.length) msg='Aujourd’hui : '+p[0].label+(p[0].time?' à '+p[0].time:'');
  }
  if(!msg&&!hasWeightToday()&&weighIns().length>=3) msg='Pas encore pesé aujourd’hui';
  if(!msg) return;
  state.ui.lastNudgeDate=isoToday(); saveNow();
  toast(msg);
}
function onAppForeground(){
  invalidateCache();
  autoBackupTick();
  swAutoCheck();          // une PWA iOS n'est jamais « relancée » : c'est ICI qu'on regarde
  render();
}
function autoBackupTick(){
  if(LOAD_ERROR) return;
  dailySnapshot();
  if(syncOn()) syncNow(false);
}
/* @@SECTION:ACTIONS@@ */

/* ============================================================
   MISE À JOUR DE L'APPLICATION
   ------------------------------------------------------------
   Une PWA installée sur l'écran d'accueil ne se recharge pas
   toute seule : iOS ne la « redémarre » jamais vraiment, il la
   réveille. Il faut donc trois choses, et les trois sont là :

   1. un service worker qui sert la coquille en RÉSEAU D'ABORD
      (cf. sw.js) — sinon on sert éternellement la veille ;
   2. une détection automatique, qui fait apparaître un bandeau
      dès qu'une version est prête ;
   3. un bouton MANUEL dans les réglages, parce que la détection
      automatique dépend du réseau et qu'il faut toujours laisser
      une porte de sortie à quelqu'un qui doute.

   Le bouton « Tout recharger » est le dernier recours : il vide
   les caches et déconnecte le worker. Il ne touche JAMAIS
   localStorage — les pesées ne sont pas dans le cache.
   ============================================================ */
let SW_REG=null, SW_WAITING=null, SW_RELOADING=false, SW_CHECKING=false, SW_LAST_CHECK=0;

function swSupported(){ return 'serviceWorker' in navigator; }
function updateReady(){ return !!SW_WAITING; }

/* Un worker « installé » alors qu'un autre contrôle déjà la page = version en attente. */
function swTrack(reg){
  if(!reg||!reg.addEventListener) return;
  SW_REG=reg;
  if(reg.waiting&&navigator.serviceWorker.controller) swReady(reg.waiting);
  reg.addEventListener('updatefound',()=>{
    const nw=reg.installing;
    if(!nw) return;
    nw.addEventListener('statechange',()=>{
      if(nw.state==='installed'&&navigator.serviceWorker.controller) swReady(nw);
    });
  });
}
function swReady(worker){
  if(SW_WAITING===worker) return;
  SW_WAITING=worker;
  render();                                    // fait apparaître le bandeau
}
function registerSW(){
  if(!swSupported()) return;
  /* Tout est enveloppé : un navigateur qui refuse les workers (navigation privée,
     vieux WebView) ne doit pas empêcher l'app de démarrer. */
  try{
    /* updateViaCache:'none' — le script du worker ne doit jamais venir du cache HTTP,
       sinon on peut rester bloqué jusqu'à 24 h sur l'ancienne version. */
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(swTrack).catch(()=>{});
    if(navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(SW_RELOADING) return;
      SW_RELOADING=true;
      location.reload();
    });
  }catch(e){}
}
/* Vérification silencieuse : au lancement, et à chaque retour au premier plan. */
function swAutoCheck(){
  if(!SW_REG||updateReady()) return;
  if(Date.now()-SW_LAST_CHECK<60000) return;   // pas plus d'une fois par minute
  SW_LAST_CHECK=Date.now();
  try{ SW_REG.update(); }catch(e){}
}
/* Vérification demandée par l'utilisateur : elle DOIT toujours répondre quelque chose. */
async function checkForUpdate(){
  if(!swSupported()){ toast('Mise à jour indisponible sur ce navigateur'); return; }
  if(SW_CHECKING) return;
  if(updateReady()){ applyUpdate(); return; }
  SW_CHECKING=true; render();
  try{
    const reg=SW_REG||await navigator.serviceWorker.getRegistration();
    if(!reg){ registerSW(); toast('Mise à jour en cours d’installation…'); return; }
    swTrack(reg);
    SW_LAST_CHECK=Date.now();
    await reg.update();
    /* `update()` rend la main dès que le script est comparé ; l'installation, elle,
       prend encore un instant. On laisse deux secondes avant de conclure. */
    await new Promise(r=>setTimeout(r,2000));
    if(updateReady()) applyUpdate();
    else toast('Tu es déjà à la dernière version ('+esc(state.meta.appVersion)+')');
  }catch(e){
    toast('Impossible de vérifier — vérifie ta connexion');
  }finally{ SW_CHECKING=false; render(); }
}
/* On bascule sur le worker en attente ; son activation déclenche `controllerchange`,
   donc le rechargement. Si rien ne vient en 4 s, on recharge nous-même. */
function applyUpdate(){
  if(!SW_WAITING){ location.reload(); return; }
  toast('Mise à jour en cours…');
  try{ SW_WAITING.postMessage({type:'SKIP_WAITING'}); }catch(e){}
  setTimeout(()=>{ if(!SW_RELOADING){ SW_RELOADING=true; location.reload(); } },4000);
}
/* Le dernier recours. Vide les caches, débranche le worker, recharge.
   Aucune donnée n'est touchée : les pesées vivent dans localStorage. */
async function hardRefresh(){
  toast('Rechargement complet…');
  try{ if(window.caches){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } }catch(e){}
  try{
    if(swSupported()){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
  }catch(e){}
  SW_RELOADING=true;
  /* Le paramètre casse le cache HTTP du document lui-même sur iOS. */
  setTimeout(()=>{ location.replace(location.pathname+'?maj='+Date.now()+location.hash); },350);
}
/* Le bandeau : discret, en haut, et il ne revient pas s'excuser. */
function updateBanner(){
  if(!updateReady()) return '';
  return '<div class="card card--accent upd-banner">'
   +'<div class="today-top"><div class="today-ic is-acc">'+ic('refresh')+'</div>'
   +'<div class="row-main"><div class="row-title">Une nouvelle version est prête</div>'
   +'<div class="small muted">Elle s’installe en deux secondes, sans rien perdre.</div></div></div>'
   +'<button class="btn btn--primary btn--block" data-act="app-update" style="margin-top:12px">Mettre à jour maintenant</button></div>';
}
/* La carte des réglages : version, vérification, et la porte de sortie. */
function updateCard(){
  const inst=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
  return '<div class="card"><div class="row-title flex aic gap8">'+ic('refresh','ic--sm')+'Version et mise à jour</div>'
   +'<div class="kv" style="margin-top:8px"><span class="kv-k">Version installée</span><span class="kv-v">Élan '+esc(state.meta.appVersion)+'</span></div>'
   +'<div class="kv"><span class="kv-k">Mode</span><span class="kv-v">'+(inst?'écran d’accueil':'navigateur')+'</span></div>'
   +(updateReady()?'<div class="hint" style="margin-top:8px;color:var(--acc-2)">Une nouvelle version est prête à être installée.</div>':'')
   +'<button class="btn '+(updateReady()?'btn--primary':'btn--ghost')+' btn--block" data-act="app-update" style="margin-top:12px">'
   +ic('refresh')+(SW_CHECKING?'Vérification…':(updateReady()?'Installer la mise à jour':'Rechercher une mise à jour'))+'</button>'
   +'<button class="btn btn--ghost btn--block" data-act="app-hard-refresh" style="margin-top:8px">'+ic('trash')+'Tout recharger depuis zéro</button>'
   +'<div class="hint" style="margin-top:10px">« Tout recharger » vide le cache de l’application et la retélécharge. '
   +'Tes pesées, tes séances et tes réglages ne sont pas dans ce cache : rien ne peut être perdu.</div></div>';
}

/* ============================================================
   INIT
   ============================================================ */
function applyAccent(){ const a=state.settings.accentTheme;
  if(a&&a!=='vert') document.documentElement.dataset.accent=a; else document.documentElement.removeAttribute('data-accent'); }
function applyPrefs(){ const s=state.settings;
  document.documentElement.setAttribute('data-density', s.density==='compact'?'compact':'comfortable');
  if(s.numberPrivacy) document.documentElement.setAttribute('data-privacy','on'); else document.documentElement.removeAttribute('data-privacy');
  if(s.reduceMotion===true) document.documentElement.dataset.motion='off'; else document.documentElement.removeAttribute('data-motion'); }

function onClick(e){ const el=e.target.closest&&e.target.closest('[data-act]'); if(!el) return; const act=el.dataset.act;
  if(ACTIONS[act]){ e.preventDefault(); ACTIONS[act](el.dataset,el); } }

function postRender(r,animate){
  mountCharts(animate);
  qa('[data-count]').forEach(el=>countUp(el,parseFloat(el.dataset.count),parseInt(el.dataset.dec||'1',10),animate!==false));
  qa('[data-ring]').forEach(setRing);
  qa('[data-bar]').forEach(el=>{ requestAnimationFrame(()=>{ el.style.width=(clamp(parseFloat(el.dataset.bar)||0,0,1)*100)+'%'; }); });
  if(typeof postRenderScreen==='function') postRenderScreen(r,animate);
}

/* ============================================================
   BARRE D'ONGLETS
   ------------------------------------------------------------
   Quatre onglets par défaut, plus le bouton central qui ne bouge
   jamais. L'utilisateur peut ajouter jusqu'à deux raccourcis vers
   les écrans qu'il ouvre le plus souvent — au-delà, les cibles
   deviennent trop étroites pour un pouce.
   ============================================================ */
const TAB_ICONS={
  '/':'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  '/courbes':'<path d="M3 17.5 9 11l4 4 8-8.5"/><path d="M21 6.5h-4.5M21 6.5V11"/>',
  '/tableau':'<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.5h18M3 14.5h18M9 4.5v15"/>',
  '/plus':'<rect x="4" y="4" width="6" height="6" rx="2"/><rect x="14" y="4" width="6" height="6" rx="2"/><rect x="4" y="14" width="6" height="6" rx="2"/><rect x="14" y="14" width="6" height="6" rx="2"/>',
  '/sport':'<path d="M5 9v6M19 9v6M8 7v10M16 7v10M8 12h8"/>',
  '/pilulier':'<rect x="3.2" y="8.4" width="17.6" height="7.2" rx="3.6"/><path d="M12 8.4v7.2"/>',
  '/calories':'<path d="M12 3.5c3 3.4 5 6 5 9a5 5 0 0 1-10 0c0-1.6.6-3 1.6-4.4.5 1.2 1.2 1.9 2 2 .3-2.4-.1-4.6 1.4-6.6Z"/>',
  '/analyse':'<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 4 4"/><path d="M8.4 11.6 10 9.6l1.7 1.6 2-2.6"/>',
  '/semaine':'<rect x="3.4" y="5" width="17.2" height="15.4" rx="3"/><path d="M3.4 9.8h17.2M8.4 3.2v3.6M15.6 3.2v3.6"/>',
  '/mensurations':'<path d="M3.3 14.5 14.5 3.3a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L9.5 20.7a1.6 1.6 0 0 1-2.3 0l-3.9-3.9a1.6 1.6 0 0 1 0-2.3Z"/><path d="m7.6 10.2 1.8 1.8M10.6 7.2l1.8 1.8M13.6 4.2l1.8 1.8M4.6 13.2l1.8 1.8"/>',
  '/simulateur':'<rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M8 7.5h8M8.5 12h1M12 12h1M15.5 12h1M8.5 16h1M12 16h1M15.5 16h1"/>',
  '/objectif':'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20"/>',
  '/paliers':'<path d="M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 5.5H4.5v1A3.5 3.5 0 0 0 8 10M17 5.5h2.5v1A3.5 3.5 0 0 1 16 10"/><path d="M12 13v3M9 20h6l-.7-4h-4.6Z"/>',
  '/sauvegarde':'<path d="M12 3v10.5M8.5 10 12 13.5 15.5 10"/><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>'};
const TAB_CHOICES=[
  {route:'/',label:'Accueil',fixed:true},
  {route:'/courbes',label:'Courbes'},
  {route:'/tableau',label:'Tableau'},
  {route:'/plus',label:'Plus',fixed:true},
  {route:'/sport',label:'Sport',mod:'sport'},
  {route:'/pilulier',label:'Pilulier',mod:'pillbox'},
  {route:'/calories',label:'Calories',mod:'kcalIn'},
  {route:'/analyse',label:'Analyse'},
  {route:'/semaine',label:'Semaine'},
  {route:'/mensurations',label:'Mensurations'},
  {route:'/simulateur',label:'Simulateur'},
  {route:'/objectif',label:'Objectif'},
  {route:'/paliers',label:'Paliers'},
  {route:'/sauvegarde',label:'Sauvegarde'}];
const TABS_DEFAULT=['/','/courbes','/tableau','/plus'];
function tabChoice(route){ return TAB_CHOICES.find(x=>x.route===route)||null; }
/* La liste effective : on retire au passage un raccourci dont le module a été coupé,
   sans l'effacer du réglage — il revient tout seul au rallumage du module. */
function tabList(){
  const raw=(state.settings.tabs&&state.settings.tabs.length>=2)?state.settings.tabs:TABS_DEFAULT;
  const out=[];
  raw.forEach(r=>{ const c=tabChoice(r);
    if(!c) return;
    if(c.mod&&!state.settings.modules[c.mod]) return;
    if(out.indexOf(r)<0) out.push(r); });
  if(out.indexOf('/')<0) out.unshift('/');
  if(out.indexOf('/plus')<0) out.push('/plus');
  return out.slice(0,6);
}
function renderTabbar(){
  const bar=document.getElementById('tabbar'); if(!bar) return;
  const list=tabList(), n=list.length, cut=Math.ceil(n/2);
  const btn=r=>{ const c=tabChoice(r);
    return '<button class="tab" data-tab="'+r+'" aria-label="'+esc(c.label)+'">'
      +'<svg viewBox="0 0 24 24" class="tab-ic">'+(TAB_ICONS[r]||TAB_ICONS['/plus'])+'</svg>'
      +'<span>'+esc(c.label)+'</span></button>'; };
  bar.innerHTML=list.slice(0,cut).map(btn).join('')
    +'<button class="fab" id="fab" aria-label="Saisir la pesée">'
    +'<svg viewBox="0 0 24 24" class="fab-ic"><path d="M12 5v14M5 12h14"/></svg></button>'
    +list.slice(cut).map(btn).join('')
    +'<span class="tab-pill" id="tabPill" aria-hidden="true"></span>';
  bar.style.gridTemplateColumns='repeat('+(n+1)+',1fr)';
  bar.classList.toggle('tabbar--dense',n>=5);
  const fabEl=document.getElementById('fab');
  if(fabEl) fabEl.addEventListener('click',()=>openWeighIn(isoToday()));
  qa('.tab').forEach(t=>t.addEventListener('click',()=>nav(t.dataset.tab)));
}
/* L'onglet allumé : celui dont la route correspond, sinon celui vers lequel ramène
   le bouton « Retour ». Un raccourci ajouté s'allume donc sur son propre écran. */
function activeTabFor(r){
  const list=tabList();
  if(list.indexOf(r)>=0) return r;
  const t=tabOf(r);
  return list.indexOf(t)>=0?t:'/plus';
}
function updateTabs(r){
  const tabs=qa('.tab'); const active=activeTabFor(r);
  let activeEl=null;
  tabs.forEach(t=>{ const on=t.dataset.tab===active; t.classList.toggle('is-active',on); if(on) activeEl=t; });
  const pill=document.getElementById('tabPill'); const bar=document.getElementById('tabbar');
  if(pill&&activeEl&&bar){ const a=activeEl.getBoundingClientRect(),b=bar.getBoundingClientRect();
    if(a.width) pill.style.transform='translateX('+(a.left-b.left+a.width/2-17)+'px)'; }
  const fabEl=document.getElementById('fab');
  if(fabEl) fabEl.classList.toggle('is-done', hasWeightToday());   // « fait » = pesé, pas juste une ligne créée
}

let BOOTED=false, HIDDEN_AT=0, LAST_W=0;
function boot(){
  applyAccent(); applyPrefs();
  document.addEventListener('click',onClick);
  renderTabbar();
  document.addEventListener('change',onChange);
  document.addEventListener('input',onInput);
  LAST_W=window.innerWidth;
  let rsz=null;
  window.addEventListener('resize',()=>{ fxResize(); updateTabs(currentRoute());
    clearTimeout(rsz); rsz=setTimeout(()=>{ if(Math.abs(innerWidth-LAST_W)>24){ LAST_W=innerWidth; render(); } },180); });
  window.addEventListener('pagehide',saveNow);
  window.addEventListener('pageshow',e=>{ if(e.persisted) onAppForeground(); });
  window.addEventListener('online',()=>{ if(typeof syncOn==='function'&&syncOn()) syncNow(false); });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){ saveNow(); HIDDEN_AT=Date.now(); }
    else if(Date.now()-HIDDEN_AT>60000) onAppForeground();
  });
  if(!location.hash){ const fs=state.settings.firstScreen; location.hash='#'+(['/','/courbes','/tableau','/plus'].indexOf(fs)>=0?fs:'/'); }
  render();
  onAppOpen();
  registerSW();
  /* iOS n'autorise aucune notification programmée depuis une PWA : le seul rappel possible
     est celui de l'ouverture. On n'en montre donc qu'UN SEUL, le plus actionnable, et
     jamais sur l'accueil — où les cartes disent déjà tout, et de façon permanente. */
  setTimeout(bootNudge,900);
}
function safeBoot(){ if(BOOTED) return; BOOTED=true; state=load(); boot(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',safeBoot); else safeBoot();
