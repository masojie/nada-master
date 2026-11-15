// tests/t_units.mjs - unit test util, FFT, resample, dither
import {FFT,nextPow2} from '../src/engine/fft.js';
import {resample} from '../src/engine/resample.js';
import {quantize} from '../src/engine/dither.js';
import {dbToLin,linToDb,clamp} from '../src/engine/util.js';
let fail=0;const ok=(n,c,i='')=>{console.log((c?'PASS ':'FAIL ')+n+(i?'  '+i:''));if(!c)fail++};
ok('dB <-> lin',Math.abs(linToDb(dbToLin(-6.02))+6.02)<1e-9&&Math.abs(dbToLin(0)-1)<1e-12);
ok('clamp',clamp(5,0,3)===3&&clamp(-1,0,3)===0);
ok('nextPow2',nextPow2(1000)===1024&&nextPow2(1024)===1024);
{const N=1024,f=new FFT(N),re=new Float64Array(N),im=new Float64Array(N);for(let i=0;i<N;i++)re[i]=Math.sin(2*Math.PI*64*i/N);
 const api=Object.getOwnPropertyNames(FFT.prototype).filter(k=>k!=='constructor');ok('FFT API tersedia',api.length>0,api.join(','));
 try{const fn=f.forward||f.transform||f.fft;fn.call(f,re,im);let m=0,k=0;for(let i=0;i<N/2;i++){const a=Math.hypot(re[i],im[i]);if(a>m){m=a;k=i}}ok('FFT puncak di bin 64',k===64,'bin='+k)}catch(e){ok('FFT forward',false,e.message)}}
{const fs=44100,N=fs,x=new Float32Array(N);for(let i=0;i<N;i++)x[i]=.5*Math.sin(2*Math.PI*1000*i/fs);
 const y=resample([x],fs,48000)[0];let s=0;for(let i=2000;i<y.length-2000;i++)s+=y[i]*y[i];const r=Math.sqrt(s/(y.length-4000));
 ok('Resample 44.1->48 panjang',y.length===48000);ok('Resample level terjaga',Math.abs(20*Math.log10(r/(.5/Math.SQRT2)))<.05,'err='+(20*Math.log10(r/(.5/Math.SQRT2))).toFixed(3)+' dB');
 const z=resample([y],48000,44100)[0];ok('Resample roundtrip panjang',Math.abs(z.length-N)<=1)}
{const fs=44100,N=fs,x=new Float32Array(N);for(let i=0;i<N;i++)x[i]=.25*Math.sin(2*Math.PI*440*i/fs);
 for(const t of ['tpdf','none']){try{const q=quantize([x],24,t,fs);const o=q.chans||q;ok('quantize 24 '+t,!!o)}catch(e){ok('quantize '+t,false,e.message)}}}
console.log(fail?fail+' GAGAL':'SEMUA LULUS');process.exit(fail?1:0);
