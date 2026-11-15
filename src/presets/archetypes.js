// presets/archetypes.js - 10 arketipe parameter mastering.
// CATATAN JUJUR: semua angka adalah TITIK AWAL terdokumentasi, belum dikalibrasi dengan audio referensi.
// rel = target spektral (dB, 10 oktaf 31.5 Hz..16 kHz) RELATIF terhadap pink noise (pink = semua 0) dan
// dinormalkan ke rata-rata oktaf 250 Hz..2 kHz, sesuai definisi analysis.js. Validasi dengan telinga + referensi.
const B=(f,g,q=1,type='bell')=>({on:true,type,f,g,q});
const MB=(r,g=[0,0,0,0],t=[-4,-4,-4,-4],a=[30,20,12,6],rl=[220,160,120,90])=>({xover:[120,1000,6000],thrOffsetDb:t,bands:[0,1,2,3].map(i=>({on:r[i]>1||g[i]!==0,ratio:r[i],attackMs:a[i],releaseMs:rl[i],gainDb:g[i]}))});
const CP=(thr,ratio,att,rel,knee=6,mk=0,mix=100)=>({thrOffsetDb:thr,ratio,attackMs:att,releaseMs:rel,kneeDb:knee,makeupDb:mk,mix,rmsMs:10,scHpfHz:90,autoRelease:true});
const TN=(l=0,c=0,p=0,a=0)=>({lowDb:l,lowHz:100,clarityDb:c,clarityHz:400,presenceDb:p,presenceHz:3500,airDb:a,airHz:12000});
export const ARCHETYPES={
 pop:{label:'Pop vokal-sentris',rel:[-10,-1,2,1,0,0,-1,-3,-6,-11],
  eq:[B(30,0,.7,'hp'),B(250,-1,1),B(3500,1,.9),B(11000,1.5,.7,'highshelf')],tone:TN(0,0,0.5,1),
  comp:CP(-6,2,30,160),mb:MB([1.8,1.6,1.8,1.5],[0,0,0,0.5]),sat:{type:'tape',driveDb:3,mix:35},
  stereo:{width:110,widthHz:250,bassMonoHz:110,monoAmount:100},clip:{on:false},limiter:{style:'balanced',releaseMs:100,lookaheadMs:3},lufs:-11},
 ballad:{label:'Ballad / akustik lembut',rel:[-11,-2,1,1,0,0,-1,-4,-8,-13],
  eq:[B(30,0,.7,'hp'),B(300,-1,1),B(3000,.8,.9),B(10000,1,.7,'highshelf')],tone:TN(0,0.5,0.5,0.5),
  comp:CP(-9,1.6,40,220),mb:MB([1.3,1.4,1.4,1.2]),sat:{type:'tube',driveDb:2,mix:25},
  stereo:{width:105,widthHz:250,bassMonoHz:100,monoAmount:100},clip:{on:false},limiter:{style:'transparent',releaseMs:140,lookaheadMs:3},lufs:-13},
 rock:{label:'Rock / band',rel:[-9,0,2,1,0.5,0.5,0,-2,-5,-10],
  eq:[B(35,0,.7,'hp'),B(300,-1.5,1),B(2500,1.2,.9),B(9000,1,.7,'highshelf')],tone:TN(0.5,0,1,0.5),
  comp:CP(-6,2.2,25,140),mb:MB([2,1.8,2,1.6]),sat:{type:'tape',driveDb:4,mix:40},
  stereo:{width:105,widthHz:250,bassMonoHz:100,monoAmount:100},clip:{on:false},limiter:{style:'balanced',releaseMs:90,lookaheadMs:3},lufs:-10},
 heavy:{label:'Heavy / padat',rel:[-8,1,2.5,1.5,0.5,0.5,0.5,-1,-4,-9],
  eq:[B(35,0,.7,'hp'),B(350,-2,1),B(2800,1,.9),B(10000,.8,.7,'highshelf')],tone:TN(0.5,0,0.5,0.5),
  comp:CP(-5,2.5,15,110),mb:MB([2.4,2.2,2.2,1.8]),sat:{type:'soft',driveDb:5,mix:35},
  stereo:{width:105,widthHz:250,bassMonoHz:120,monoAmount:100},clip:{on:true,mode:'soft',thrDb:0.5,kneeDb:2},limiter:{style:'punchy',releaseMs:70,lookaheadMs:2},lufs:-9},
 dance:{label:'Elektronik / dance',rel:[-6,3,4,1,0,0,-1,-2,-4,-8],
  eq:[B(25,0,.7,'hp'),B(250,-1.5,1),B(60,1,1,'lowshelf'),B(10000,1,.7,'highshelf')],tone:TN(1,0,0,1),
  comp:CP(-5,2.2,20,100),mb:MB([2.2,2,2,1.6],[0.5,0,0,0.5]),sat:{type:'soft',driveDb:5,mix:35},
  stereo:{width:115,widthHz:300,bassMonoHz:130,monoAmount:100},clip:{on:true,mode:'soft',thrDb:0.5,kneeDb:2},limiter:{style:'punchy',releaseMs:60,lookaheadMs:2},lufs:-9},
 urban:{label:'Hip-hop / urban (sub berat)',rel:[-3,4,3,1,0,0,-1,-3,-5,-9],
  eq:[B(25,0,.7,'hp'),B(300,-2,1),B(55,1.5,1,'lowshelf'),B(3500,0.8,.9),B(10000,1,.7,'highshelf')],tone:TN(1,0,0.5,0.5),
  comp:CP(-6,2.2,25,120),mb:MB([2.2,2,2,1.6],[0.5,0,0,0]),sat:{type:'tube',driveDb:4,mix:35},
  stereo:{width:108,widthHz:250,bassMonoHz:150,monoAmount:100},clip:{on:true,mode:'soft',thrDb:0.5,kneeDb:2},limiter:{style:'balanced',releaseMs:80,lookaheadMs:3},lufs:-10},
 indo:{label:'Musik Indonesia (vokal + perkusi)',rel:[-9,0,2.5,1,0,0.5,0,-2,-5,-10],
  eq:[B(30,0,.7,'hp'),B(280,-1,1),B(3200,1.2,.9),B(10000,1,.7,'highshelf')],tone:TN(0.5,0,1,0.5),
  comp:CP(-6,2.2,25,140),mb:MB([2,1.8,1.8,1.5]),sat:{type:'tape',driveDb:3,mix:35},
  stereo:{width:105,widthHz:250,bassMonoHz:100,monoAmount:100},clip:{on:false},limiter:{style:'balanced',releaseMs:100,lookaheadMs:3},lufs:-11},
 trad:{label:'Tradisional / natural',rel:[-12,-3,0,1,0.5,0,-1,-4,-8,-13],
  eq:[B(30,0,.7,'hp'),B(3000,0.5,.9),B(10000,0.5,.7,'highshelf')],tone:TN(0,0,0.5,0),
  comp:CP(-10,1.4,40,240),mb:MB([1.2,1.2,1.2,1.1]),sat:{type:'tube',driveDb:2,mix:20},
  stereo:{width:100,widthHz:250,bassMonoHz:80,monoAmount:100},clip:{on:false},limiter:{style:'transparent',releaseMs:150,lookaheadMs:3},lufs:-14},
 dynamic:{label:'Akustik / jazz / klasik (dinamis)',rel:[-12,-3,0,1,0.5,0,-1,-4,-8,-13],
  eq:[B(25,0,.7,'hp'),B(10000,0.5,.7,'highshelf')],tone:TN(0,0,0,0),
  comp:CP(-12,1.2,50,260,8),mb:MB([1,1,1,1]),sat:{type:'none',driveDb:0,mix:0},
  stereo:{width:100,widthHz:250,bassMonoHz:0,monoAmount:100},clip:{on:false},limiter:{style:'transparent',releaseMs:200,lookaheadMs:4},lufs:-16},
 ambient:{label:'Ambient / sinematik',rel:[-9,-1,1,1,0.5,0,-1,-4,-8,-12],
  eq:[B(25,0,.7,'hp'),B(10000,0.8,.7,'highshelf')],tone:TN(0,0,0,0.5),
  comp:CP(-12,1.3,60,280,8),mb:MB([1.1,1.1,1.1,1.1]),sat:{type:'tube',driveDb:2,mix:20},
  stereo:{width:125,widthHz:250,bassMonoHz:80,monoAmount:100},clip:{on:false},limiter:{style:'transparent',releaseMs:200,lookaheadMs:4},lufs:-16}
};
