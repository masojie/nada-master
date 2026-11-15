// tests/t_presets.mjs - validasi katalog genre dan kompatibilitas dengan engine
import {GENRES,CATEGORIES,VOICINGS,applyVoicing,tiltFromRel} from '../src/presets/genres.js';
import {validateAll,validateGenre} from '../src/presets/validate.js';
import {analyzeAudio,detectProblems} from '../src/engine/analysis.js';
import {EQStage,ToneStage,CompStage,MBStage,SatStage,StereoStage,ClipStage,runBlockStage} from '../src/engine/modules.js';
let fail=0;const ok=(n,c,i='')=>{console.log((c?'PASS ':'FAIL ')+n+(i?'  '+i:''));if(!c)fail++};
ok('jumlah genre >= 68',GENRES.length>=68,String(GENRES.length));ok('id unik',new Set(GENRES.map(g=>g.id)).size===GENRES.length);
ok('6 kategori terisi',CATEGORIES.every((c,i)=>GENRES.some(g=>g.categoryIndex===i)),CATEGORIES.map((c,i)=>GENRES.filter(g=>g.categoryIndex===i).length).join('/'));
const bad=validateAll(GENRES);ok('semua genre lolos validasi',Object.keys(bad).length===0,JSON.stringify(bad).slice(0,300));
for(const v of Object.keys(VOICINGS)){const e=validateAll(GENRES.map(g=>applyVoicing(g,v)));ok('voicing '+v+' lolos validasi untuk semua genre',Object.keys(e).length===0,JSON.stringify(e).slice(0,200))}
ok('tilt konsisten dengan rumus engine',GENRES.every(g=>Math.abs(g.tilt-tiltFromRel(g.targetRel))<.01));
ok('validator menolak targetRel salah',validateGenre({...GENRES[0],targetRel:[1,2,3]}).length>0);
ok('validator menolak stereo tanpa widthHz',validateGenre({...GENRES[0],settings:{...GENRES[0].settings,stereo:{width:110,bassMonoHz:100}}}).length>0);
// detectProblems untuk tiap genre
const fs=48000,N=fs*4,L=new Float32Array(N),R=new Float32Array(N);for(let i=0;i<N;i++){L[i]=.3*Math.sin(i*.03)+.1*Math.sin(i*.4);R[i]=.3*Math.sin(i*.031)+.1*Math.sin(i*.41)}
const an=analyzeAudio([L,R],fs);let dpOK=true,msg='';for(const g of GENRES){try{const p=detectProblems(an,g);if(!Array.isArray(p))throw new Error('bukan array')}catch(e){dpOK=false;msg=g.name+': '+e.message;break}}ok('detectProblems jalan untuk semua genre',dpOK,msg);
// instansiasi + proses tiap stage dengan parameter genre
let stageOK=true;msg='';const fin=c=>c.every(x=>x.every(Number.isFinite));
const mus=()=>[Float32Array.from(L,v=>v*1.5),Float32Array.from(R,v=>v*1.5)];
for(const g of GENRES){const s=g.settings;try{const c=mus();
 runBlockStage(new EQStage({bands:s.eq},fs,2),c);runBlockStage(new ToneStage(s.tone,fs,2),c);
 runBlockStage(new CompStage({...s.comp,ratio:s.comp.ratio},fs,2,-20+s.comp.thrOffsetDb),c);
 runBlockStage(new MBStage({xover:s.mb.xover,bands:s.mb.bands},fs,2,s.mb.thrOffsetDb.map(t=>-30+t)),c);
 if(s.sat.type!=='none'){const o={os:2,tape:{on:false},tube:{on:false},transformer:{on:false},soft:{on:false},exciter:{on:false}};o[s.sat.type==='transformer'?'transformer':s.sat.type]={on:true,driveDb:s.sat.driveDb,mix:s.sat.mix};runBlockStage(new SatStage(o,fs,2),c)}
 runBlockStage(new StereoStage(s.stereo,fs,2),c);if(s.clip.on)runBlockStage(new ClipStage({mode:s.clip.mode,thrDb:s.clip.thrDb,kneeDb:s.clip.kneeDb,os:4},s.limiter.ceilingDb,fs,2),c);
 if(!fin(c))throw new Error('NaN/Inf')}catch(e){stageOK=false;msg=g.name+': '+e.message;break}}
ok('semua genre dapat dijalankan lewat seluruh stage tanpa NaN',stageOK,msg);
console.log(fail?fail+' GAGAL':'SEMUA LULUS');process.exit(fail?1:0);
