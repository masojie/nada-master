// tests/t_codec_meter.mjs - codec WAV/FLAC, loudness, true-peak, limiter
import {encodeWav,decodeWav,detectFormat} from '../src/engine/codecs.js';
import {quantize} from '../src/engine/dither.js';
import {encodeFlac,decodeFlac} from '../src/engine/flac.js';
import {measureLoudness,measureTruePeak} from '../src/engine/loudness.js';
import {runLimiter} from '../src/engine/limiter.js';
let fail=0;const ok=(n,c,i='')=>{console.log((c?'PASS ':'FAIL ')+n+(i?'  '+i:''));if(!c)fail++};
const fs=48000,N=fs*3,L=new Float32Array(N),R=new Float32Array(N);for(let i=0;i<N;i++){L[i]=.5*Math.sin(2*Math.PI*997*i/fs);R[i]=.5*Math.sin(2*Math.PI*997*i/fs)}
// EBU: sinus 997 Hz stereo -> -3.01 dBFS tiap kanal -> sekitar -0.691+10log10(2*0.125*..) dibandingkan dengan nilai teori
const l=measureLoudness([L,R],fs).integrated;const theory=10*Math.log10(2*(0.5*0.5/2));ok('Loudness sinus 997 Hz = teori BS.1770 (K-weighting +0.691 dB di 997 Hz meniadakan offset)',Math.abs(l-theory)<0.05,'ukur='+l.toFixed(2)+' teori='+theory.toFixed(2));
for(const bits of [16,24]){const q=quantize([L,R],bits,'tpdf',fs);ok('quantize '+bits+' tanpa clipping',q.clipped===0,'mode='+q.mode);const u=encodeWav(q.ints,fs,bits,false);const d=decodeWav(u);let m=0;for(let i=0;i<N;i++)m=Math.max(m,Math.abs(d.chans[0][i]-L[i]));ok('WAV '+bits+'-bit roundtrip',d.fs===fs&&d.chans.length===2&&m<(bits==16?1e-4:1e-6),'maxerr='+m.toExponential(1));ok('detectFormat wav '+bits,String(detectFormat(u)).toLowerCase().includes('wav'))}
{const u=encodeWav([L,R],fs,32,true);const d=decodeWav(u);let m=0;for(let i=0;i<N;i++)m=Math.max(m,Math.abs(d.chans[0][i]-L[i]));ok('WAV 32f roundtrip',m<1e-7)}
{const ints=[Int32Array.from(L,x=>Math.round(x*8388607)),Int32Array.from(R,x=>Math.round(x*8388607))];const u=encodeFlac(ints,fs,24);const d=decodeFlac(u);let diff=0;for(let c=0;c<2;c++)for(let i=0;i<N;i++)if(d.ints[c][i]!==ints[c][i])diff++;ok('FLAC 24-bit lossless',diff===0,'beda='+diff+' ukuran='+(u.length/1024|0)+'KB')}
{const x=[Float32Array.from(L,v=>v*4),Float32Array.from(R,v=>v*4)];const before=measureTruePeak(x,fs).dbtp;runLimiter(x,{ceilingDb:-1,lookaheadMs:3,style:'balanced',releaseMs:100},fs);const a=measureTruePeak(x,fs).dbtp;ok('Limiter true-peak <= -1 dBTP',a<=-0.95,before.toFixed(2)+' -> '+a.toFixed(2))}
{const x=[new Float32Array(N),new Float32Array(N)];x[0][1000]=2;x[1][1000]=-2;const before=measureTruePeak(x,fs).dbtp;runLimiter(x,{ceilingDb:-1,lookaheadMs:3,style:'punchy',releaseMs:50},fs);ok('Limiter impuls tunggal',measureTruePeak(x,fs).dbtp<=-0.95,before.toFixed(2)+' -> '+measureTruePeak(x,fs).dbtp.toFixed(2))}
console.log(fail?fail+' GAGAL':'SEMUA LULUS');process.exit(fail?1:0);
