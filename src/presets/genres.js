// presets/genres.js - katalog genre (68), voicing preset (6), pembangun objek genre untuk detectProblems() dan pipeline.
import {ARCHETYPES} from './archetypes.js';
import {mergeDeep,cloneDeep} from '../engine/util.js';
export const CATEGORIES=['Pop & Vocal','Rock & Alternative','Electronic & Dance','Hip-Hop & Urban','Indonesian Music','Acoustic & Other'];
// [nama, kategori(index), arketipe, penyesuaian {dr:[10 delta rel], ...override pengaturan}, deskripsi karakter]
const G=[
['Pop Indonesia',0,'indo',{},'Vokal jelas di depan, perkusi tegas, terang secukupnya.'],
['Pop Ballad',0,'ballad',{},'Lembut dan hangat, dinamika dijaga, vokal intim.'],
['Pop Modern',0,'pop',{lufs:-10},'Rapat, terang, bass bersih, loudness kompetitif.'],
['Indie Pop',0,'pop',{lufs:-12,dr:[0,0,0,0,0,0,0,0,1,1]},'Natural, sedikit lo-fi, tidak terlalu dikompres.'],
['Dream Pop',0,'ambient',{lufs:-13,stereo:{width:120}},'Lebar dan berkabut, highs lembut.'],
['Synth Pop',0,'dance',{lufs:-10,dr:[-2,-1,-1,0,0,0,0,0,1,1]},'Synth jelas, bass kencang tapi terkontrol.'],
['Electropop',0,'pop',{lufs:-9,dr:[0,1,1,0,0,0,0,1,1,1]},'Cerah, bass padat, vokal diproses rapat.'],
['R&B',0,'urban',{lufs:-11,dr:[-1,-1,-1,0,0,0,0,0,0,0]},'Halus, bass hangat, vokal licin.'],
['Soul',0,'ballad',{lufs:-12,dr:[0,0,1,1,0,0,0,0,0,0]},'Hangat, organik, dinamika hidup.'],
['Neo Soul',0,'ballad',{lufs:-12,dr:[0,1,1,1,0,0,0,-1,-1,-1]},'Hangat dan gelap, bass bulat.'],
['Alternative Pop',0,'pop',{lufs:-11},'Seimbang dengan karakter eksperimen.'],
['Acoustic Pop',0,'ballad',{lufs:-12},'Instrumen akustik natural, vokal hangat.'],
['Soft Rock',1,'ballad',{lufs:-12,dr:[0,0,0,0,0,1,1,1,0,0]},'Hangat, gitar halus, dinamika terjaga.'],
['Pop Rock',1,'rock',{lufs:-10,dr:[0,0,0,0,0,0,0,1,1,1]},'Gitar jelas, vokal depan, rapat.'],
['Alternative Rock',1,'rock',{lufs:-10},'Gitar tebal, mid kuat.'],
['Indie Rock',1,'rock',{lufs:-11,dr:[0,0,0,0,0,0,1,1,1,1]},'Mentah dan hidup, tidak terlalu rapat.'],
['Hard Rock',1,'rock',{lufs:-9,dr:[0,1,1,0,0,1,1,0,0,0]},'Agresif, mid dorong, drum keras.'],
['Classic Rock',1,'rock',{lufs:-12,dr:[0,0,1,1,0,0,0,-1,-1,-2]},'Hangat era analog, high lebih lembut.'],
['Punk Rock',1,'heavy',{lufs:-9,dr:[0,-1,-1,0,0,1,1,1,0,0]},'Cepat, kasar, mid agresif.'],
['Metal',1,'heavy',{lufs:-9},'Padat, kencang, low presisi.'],
['Heavy Metal',1,'heavy',{lufs:-9,dr:[0,0,0,0,0,0,1,1,0,0]},'Gitar tajam, bass tegas.'],
['Post Rock',1,'ambient',{lufs:-12,dr:[1,1,1,1,0,0,0,0,0,0],stereo:{width:115}},'Dinamika besar, lebar, crescendo.'],
['Grunge',1,'heavy',{lufs:-10,dr:[0,1,1,1,1,0,-1,-1,-1,-1]},'Kotor, mid tebal, high gelap.'],
['Emo Rock',1,'rock',{lufs:-10},'Vokal emosional di depan, gitar terang.'],
['EDM',2,'dance',{},'Kick kuat, bass kencang, sangat keras.'],
['House',2,'dance',{lufs:-9},'Groove bass bulat, hi-hat jelas.'],
['Deep House',2,'dance',{lufs:-10,dr:[1,1,1,1,0,0,-1,-1,-1,-1]},'Hangat, bass dalam, high lembut.'],
['Tech House',2,'dance',{lufs:-9},'Kering, perkusif, bass tight.'],
['Progressive House',2,'dance',{lufs:-9,stereo:{width:120}},'Melodik dan lebar.'],
['Future Bass',2,'dance',{lufs:-8,dr:[0,0,0,0,0,0,1,1,1,1],stereo:{width:125}},'Supersaw lebar, drop keras.'],
['Dubstep',2,'dance',{lufs:-8,dr:[1,2,1,0,0,0,0,0,0,0]},'Sub dalam, mid agresif.'],
['Trance',2,'dance',{lufs:-9,dr:[0,0,0,0,0,1,1,1,1,1]},'Terang, lead tajam, kick tegas.'],
['Techno',2,'dance',{lufs:-9,dr:[0,1,1,0,0,0,0,-1,-1,-1]},'Gelap, repetitif, kick dominan.'],
['Drum & Bass',2,'dance',{lufs:-8,dr:[1,1,0,0,0,0,0,1,1,1]},'Bass dalam, drum cepat dan tajam.'],
['Synthwave',2,'dance',{lufs:-10,dr:[0,0,0,0,0,0,1,0,-1,-1]},'Hangat retro, synth tebal.'],
['Disco',2,'pop',{lufs:-10,dr:[0,0,1,1,0,0,0,1,1,1]},'Bass funky, string dan hi-hat jelas.'],
['Hip-Hop',3,'urban',{},'Kick dan bass dominan, vokal rap depan.'],
['Trap',3,'urban',{lufs:-9,dr:[2,1,0,0,0,0,0,1,1,1]},'808 dalam, hi-hat tajam.'],
['Boom Bap',3,'urban',{lufs:-11,dr:[-2,0,1,1,0,0,0,-1,-2,-2]},'Drum sampling hangat, bass bulat.'],
['Drill',3,'urban',{lufs:-9,dr:[1,1,0,0,0,0,0,0,0,0]},'Gelap, sub kuat, vokal kering.'],
['Lo-Fi Hip-Hop',3,'urban',{lufs:-14,dr:[-1,0,1,1,1,0,-1,-3,-4,-5],stereo:{width:100}},'Hangat, berdebu, high dipotong.'],
['R&B Trap',3,'urban',{lufs:-10},'Vokal halus di atas bass trap.'],
['Rap',3,'urban',{lufs:-10,dr:[-1,0,0,0,0,1,1,0,0,0]},'Vokal sangat jelas, intelligibility utama.'],
['Phonk',3,'urban',{lufs:-9,dr:[0,1,1,1,0,0,-1,-1,-2,-2]},'Kasar, distorsi cowbell, bass tebal.'],
['Reggaeton',3,'urban',{lufs:-9,dr:[0,0,1,0,0,0,0,1,1,1]},'Dembow tegas, vokal cerah.'],
['Afrobeats',3,'urban',{lufs:-10,dr:[-1,0,0,0,0,0,1,1,1,1]},'Perkusi hidup, bass bulat, terang.'],
['Dangdut',4,'indo',{lufs:-10,dr:[0,0,1,0,0,0,1,1,1,0]},'Kendang dan bass menonjol, vokal depan, cerah.'],
['Dangdut Koplo',4,'indo',{lufs:-9,dr:[0,1,1,0,0,0,1,1,1,1]},'Kendang cepat dan keras, energi tinggi.'],
['Dangdut Klasik',4,'indo',{lufs:-11,dr:[0,0,0,0,0,0,0,0,-1,-1]},'Orkes dan suling hangat, vokal merdu.'],
['Pop Jawa',4,'indo',{lufs:-11},'Vokal dan kendang jelas, campuran tradisi modern.'],
['Campursari',4,'trad',{lufs:-13},'Gamelan dan keyboard seimbang, hangat.'],
['Keroncong',4,'trad',{lufs:-14,dr:[0,0,1,1,0,0,-1,-2,-2,-2]},'Hangat, ukulele dan biola lembut.'],
['Gamelan',4,'trad',{lufs:-16,dr:[-1,-1,0,0,0,0,1,1,1,1]},'Logam beresonansi, transient dijaga.'],
['Pop Melayu',4,'indo',{lufs:-11,dr:[0,0,1,0,0,0,0,0,0,0]},'Melodi sendu, gendang dan vokal jelas.'],
['Lagu Religi',4,'ballad',{lufs:-13,dr:[0,0,0,0,0,1,1,0,0,0]},'Vokal bersih dan hangat, ruang natural.'],
['Pop Akustik Indonesia',4,'ballad',{lufs:-12},'Gitar akustik dan vokal intim.'],
['Acoustic',5,'dynamic',{lufs:-14},'Natural, dinamika dijaga.'],
['Fingerstyle',5,'dynamic',{lufs:-15,dr:[0,0,0,0,0,0,1,1,1,0]},'Detail gitar jelas, resonansi alami.'],
['Folk',5,'dynamic',{lufs:-14,dr:[0,0,1,1,0,0,0,-1,-1,-1]},'Hangat dan organik.'],
['Country',5,'rock',{lufs:-11,dr:[-1,-1,0,0,0,1,1,1,1,0]},'Gitar twang, vokal depan, terang.'],
['Jazz',5,'dynamic',{lufs:-16,dr:[0,0,0,0,0,0,0,0,-1,-1]},'Dinamika lebar, ruang natural.'],
['Blues',5,'dynamic',{lufs:-14,dr:[0,0,1,1,1,0,0,-1,-2,-2]},'Hangat, mid kaya.'],
['Classical',5,'dynamic',{lufs:-18,stereo:{width:100}},'Dinamika maksimal, hampir tanpa kompresi.'],
['Orchestral',5,'dynamic',{lufs:-17,dr:[0,0,0,0,0,0,0,0,1,1]},'Rentang dinamik besar, stage lebar.'],
['Ambient',5,'ambient',{lufs:-17},'Lapang dan lembut.'],
['Cinematic',5,'ambient',{lufs:-14,dr:[1,1,0,0,0,0,0,0,0,0]},'Dramatis, low besar, dinamika luas.'],
['Reggae',5,'urban',{lufs:-11,dr:[-1,0,1,1,0,0,-1,-1,-1,-1],stereo:{width:100}},'Bass bulat hangat, skank jelas.'],
['World Music',5,'trad',{lufs:-14}, 'Natural, perkusi dan instrumen etnik jelas.']
];
// Voicing: tambahan karakter di atas genre apa pun, hanya memakai parameter yang ada di engine.
export const VOICINGS={
 balanced:{label:'Balanced',desc:'Tanpa perubahan tambahan, titik tengah.',patch:{}},
 vocalClarity:{label:'Vocal Clarity',desc:'Presence vokal naik, mud 300 Hz dikurangi.',patch:{tone:{presenceDb:1.5,clarityDb:-1},sat:{mix:20}}},
 warmAnalog:{label:'Warm Analog',desc:'Low lebih hangat, saturasi tape lebih banyak, high lembut.',patch:{tone:{lowDb:1.5,airDb:-0.5},sat:{type:'tape',driveDb:5,mix:50}}},
 punchy:{label:'Punchy',desc:'Transient dijaga, kompresi lebih cepat dan limiter punchy.',patch:{comp:{attackMs:35,ratio:2.4},limiter:{style:'punchy',releaseMs:70}}},
 bright:{label:'Bright',desc:'Air dan presence naik.',patch:{tone:{airDb:2,presenceDb:1.5}}},
 smooth:{label:'Smooth',desc:'Kompresi lembut, high sedikit diredam, limiter transparan.',patch:{comp:{ratio:1.5,attackMs:45},tone:{airDb:-1,presenceDb:-0.5},limiter:{style:'transparent',releaseMs:150}}}
};
export const tiltFromRel=(rel)=>{const xs=[],ys=[];for(let i=2;i<=8;i++){xs.push(i);ys.push(rel[i])}const mx=xs.reduce((a,b)=>a+b)/xs.length,my=ys.reduce((a,b)=>a+b)/ys.length;let n=0,d=0;for(let i=0;i<xs.length;i++){n+=(xs[i]-mx)*(ys[i]-my);d+=(xs[i]-mx)**2}return n/d};
const slug=s=>s.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function buildGenre(name,cat,arch,adj,desc){const A=ARCHETYPES[arch];const {dr,lufs,...ov}=adj||{};const rel=A.rel.map((v,i)=>+(v+(dr?dr[i]:0)).toFixed(2));
 const settings=mergeDeep(cloneDeep({pre:{rumble:true,rumbleHz:25,rumbleSlope:24,dcRemove:true,autoHeadroom:true,refLufs:-18,inputGainDb:0},eq:A.eq,tone:A.tone,comp:A.comp,mb:A.mb,sat:A.sat,stereo:A.stereo,clip:A.clip,limiter:{ceilingDb:-1,tpDetect:true,...A.limiter}}),cloneDeep(ov));
 return {id:slug(name),name,category:CATEGORIES[cat],categoryIndex:cat,archetype:arch,description:desc,targetRel:rel,tilt:+tiltFromRel(rel).toFixed(3),lufs:lufs==null?A.lufs:lufs,settings,calibration:'unverified'}}
export const GENRES=G.map(g=>buildGenre(...g));
export const genreById=Object.fromEntries(GENRES.map(g=>[g.id,g]));
export function applyVoicing(genre,voicingId){const v=VOICINGS[voicingId]||VOICINGS.balanced;const o=cloneDeep(genre);o.settings=mergeDeep(o.settings,cloneDeep(v.patch));o.voicing=voicingId;return o}
