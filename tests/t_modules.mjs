// tests/t_modules.mjs - uji modul DSP: stabilitas (NaN/Inf), respons, level, latensi
import {EQStage,LinearPhaseEQStage,CompStage,MBStage,SatStage,StereoStage,ToneStage,ClipStage,PreStage,runBlockStage} from '../src/engine/modules.js';
import {runLimiter} from '../src/engine/limiter.js';
import {measureTruePeak,measureLoudness} from '../src/engine/loudness.js';
let fail=0;const ok=(n,c,i='')=>{console.log((c?'PASS ':'FAIL ')+n+(i?'  '+i:''));if(!c)fail++};
const rms=(x,a=0,b=x.length)=>{let s=0;for(let i=a;i<b;i++)s+=x[i]*x[i];return Math.sqrt(s/(b-a))};
const db=x=>20*Math.log10(x+1e-12),fin=c=>c.every(x=>{for(let i=0;i<x.length;i++)if(!Number.isFinite(x[i]))return false;return true});
const pk=c=>Math.max(...c.map(x=>{let m=0;for(let i=0;i<x.length;i++){const a=Math.abs(x[i]);if(a>m)m=a}return m}));
const tone=(f,a,fs,sec=2)=>{const N=Math.round(fs*sec),x=new Float32Array(N);for(let i=0;i<N;i++)x[i]=a*Math.sin(2*Math.PI*f*i/fs);return[x,Float32Array.from(x)]};
const music=(fs,sec=8)=>{const N=fs*sec,L=new Float32Array(N),R=new Float32Array(N);let s=7;const r=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296-.5};
 for(let i=0;i<N;i++){const t=i/fs,e=.4+.6*Math.pow(Math.sin(Math.PI*2*t)**2,3),bd=Math.exp(-((t*2)%1)*12);
  const m=.3*Math.sin(2*Math.PI*70*t)*bd+.18*Math.sin(2*Math.PI*220*t)*e+.12*Math.sin(2*Math.PI*1200*t)*e+.06*r();
  L[i]=m+.1*Math.sin(2*Math.PI*3100*t)*e;R[i]=m+.1*Math.sin(2*Math.PI*2700*t)*e}return[L,R]};
const run=(m,ch)=>{const c=ch.map(x=>Float32Array.from(x));runBlockStage(m,c);return c};
const gainAt=(mk,f,fs,a=.1)=>{const c=tone(f,a,fs);const o=run(mk(),c);const h=c[0].length>>1;return db(rms(o[0],h))-db(rms(c[0],h))};
const BANDS32=[...Array(32)].map((_,i)=>({on:true,type:'bell',f:20*Math.pow(1000,i/31),q:4.3,g:i%2?4:-4}));
for(const fs of [44100,48000,96000]){
 console.log('--- fs',fs);
 const mus=music(fs);
 // EQ
 const flat=run(new EQStage({bands:[{on:true,type:'bell',f:1000,q:1,g:0}]},fs,2),mus);let md=0;for(let i=0;i<mus[0].length;i++)md=Math.max(md,Math.abs(flat[0][i]-mus[0][i]));
 ok('EQ flat = identity',md<1e-6,'maxdiff='+md.toExponential(1));
 const g1=gainAt(()=>new EQStage({bands:[{on:true,type:'bell',f:1000,q:1.2,g:6}]},fs,2),1000,fs);ok('EQ bell +6 dB @1k',Math.abs(g1-6)<.3,'gain='+g1.toFixed(2));
 const g2=gainAt(()=>new EQStage({bands:[{on:true,type:'hp',f:100,slope:24}]},fs,2),30,fs);ok('EQ HP24 100Hz atenuasi @30Hz',g2<-30,'gain='+g2.toFixed(1));
 let t0=performance.now();const e32=run(new EQStage({bands:BANDS32},fs,2),mus);const dt=(performance.now()-t0)/1000;
 ok('EQ 32 band finite',fin(e32),'waktu '+dt.toFixed(2)+'s utk 8s audio (x'+(8/dt).toFixed(1)+' realtime)');
 const lp=gainAt(()=>new LinearPhaseEQStage({bands:[{on:true,type:'bell',f:1000,q:1.2,g:6}]},fs,2),1000,fs);ok('LinearPhase bell +6 dB @1k',Math.abs(lp-6)<.5,'gain='+lp.toFixed(2));
 ok('LinearPhase musik finite',fin(run(new LinearPhaseEQStage({bands:BANDS32},fs,2),mus)));
 // Comp
 const cp={attackMs:10,releaseMs:120,kneeDb:6,makeupDb:0,mix:100,rmsMs:10,scHpfHz:80,autoRelease:false,ratio:4};
 const cg=gainAt(()=>new CompStage({...cp},fs,2,-24),1000,fs,.5);ok('Comp thr -24 ratio 4 menurunkan level',cg<-4&&cg>-14,'GR='+cg.toFixed(1)+' dB');
 const cq=gainAt(()=>new CompStage({...cp},fs,2,-24),1000,fs,.005);ok('Comp di bawah threshold ~transparan',Math.abs(cq)<.3,'gain='+cq.toFixed(2));
 ok('Comp musik finite',fin(run(new CompStage({...cp},fs,2,-20),mus)));
 // MB
 const mbp=r=>({xover:[120,1000,6000],bands:[0,1,2,3].map(()=>({on:true,ratio:r,attackMs:15,releaseMs:150,gainDb:0}))});
 const mbf=gainAt(()=>new MBStage(mbp(1),fs,2,[-30,-30,-30,-30]),1000,fs);ok('MB ratio 1 ~flat @1k',Math.abs(mbf)<.4,'gain='+mbf.toFixed(2));
 const mbm=run(new MBStage(mbp(3),fs,2,[-30,-30,-30,-30]),mus);ok('MB musik finite+panjang sama',fin(mbm)&&mbm[0].length===mus[0].length,'rms '+db(rms(mus[0])).toFixed(1)+' -> '+db(rms(mbm[0])).toFixed(1));
 // Sat
 const sp=(o)=>({os:2,tape:{on:false},tube:{on:false},transformer:{on:false},soft:{on:false},exciter:{on:false},...o});
 for(const k of ['tape','tube','transformer','soft'])ok('Sat '+k+' finite',fin(run(new SatStage(sp({[k]:{on:true,driveDb:6,mix:100}}),fs,2),mus)));
 ok('Sat exciter finite',fin(run(new SatStage(sp({exciter:{on:true,amount:30,freq:4000}}),fs,2),mus)));
 const st0=tone(1000,.5,fs),st1=run(new SatStage(sp({soft:{on:true,driveDb:12,mix:100}}),fs,2),st0);ok('Sat soft menambah distorsi (crest turun)',pk(st1)/rms(st1[0])<pk(st0)/rms(st0[0]));
 // Clip
 const cl=(mode)=>run(new ClipStage({mode,thrDb:0,kneeDb:2,os:4},-1,fs,2),music(fs).map(x=>x.map(v=>v*3)));
 for(const mode of ['soft','hard']){const o=cl(mode);ok('Clip '+mode+' puncak <= ceiling +0.35 dB (limiter menutup sisanya)',pk(o)<=Math.pow(10,-0.65/20)&&fin(o),'peak='+db(pk(o)).toFixed(2)+' dBFS')}
 // Tone & Stereo
 const tp={lowDb:3,lowHz:100,clarityDb:0,clarityHz:400,presenceDb:2,presenceHz:3500,airDb:2,airHz:12000};
 ok('Tone finite',fin(run(new ToneStage(tp,fs,2),mus)));
 const w0=run(new StereoStage({width:0,widthHz:200,bassMonoHz:0},fs,2),mus);let sd=0;for(let i=0;i<w0[0].length;i++)sd=Math.max(sd,Math.abs(w0[0][i]-w0[1][i]));ok('Stereo width 0 = mono (residu < -60 dB)',sd<1e-3,'diff='+sd.toExponential(1));
 const w2=run(new StereoStage({width:150,widthHz:200,bassMonoHz:150,monoAmount:100},fs,2),mus);ok('Stereo width 150 + bass mono finite',fin(w2));
 // mono
 ok('EQ input mono tidak crash',fin(run(new EQStage({bands:BANDS32},fs,1),[mus[0]])));
 // Silence / DC
 const sil=[new Float32Array(fs),new Float32Array(fs)];ok('Chain diam tetap diam (no NaN)',fin(run(new CompStage({...cp},fs,2,-20),sil))&&fin(run(new MBStage(mbp(2),fs,2,[-30,-30,-30,-30]),sil)));
 // Chain + limiter
 let c=music(fs).map(x=>Float32Array.from(x,v=>v*2));
 for(const m of [new EQStage({bands:BANDS32.map(b=>({...b,g:b.g/2}))},fs,2),new CompStage({...cp},fs,2,-22),new MBStage(mbp(2),fs,2,[-28,-28,-28,-28]),new SatStage(sp({tape:{on:true,driveDb:4,mix:60}}),fs,2),new StereoStage({width:110,widthHz:200,bassMonoHz:120,monoAmount:100},fs,2)])runBlockStage(m,c);
 runLimiter(c,{ceilingDb:-1,lookaheadMs:3,style:'balanced',releaseMs:100},fs);
 const tpk=measureTruePeak(c,fs);ok('Rantai lengkap: true peak <= -1 dBTP',tpk.dbtp<=-0.95&&fin(c),'TP='+tpk.dbtp.toFixed(2)+' LUFS='+measureLoudness(c,fs).integrated.toFixed(1));
}
console.log(fail?('\n'+fail+' GAGAL'):'\nSEMUA LULUS');process.exit(fail?1:0);
