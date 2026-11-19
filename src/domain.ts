import { z } from 'zod';
export const stats = ['str','dex','con','int','wis','cha'] as const;
export const statNames = {str:'Сила',dex:'Ловкость',con:'Телосложение',int:'Интеллект',wis:'Мудрость',cha:'Харизма'};
export {classes,type ClassId} from './rules';
import {classes,classIds,sourceSpells,baseEdition,type ClassId} from './rules';
export const skills:Record<string,{name:string;stat:typeof stats[number]}> = {
  athletics:{name:'Атлетика',stat:'str'},acrobatics:{name:'Акробатика',stat:'dex'},stealth:{name:'Скрытность',stat:'dex'},sleight:{name:'Ловкость рук',stat:'dex'},arcana:{name:'Магия',stat:'int'},history:{name:'История',stat:'int'},investigation:{name:'Расследование',stat:'int'},nature:{name:'Природа',stat:'int'},religion:{name:'Религия',stat:'int'},animal:{name:'Уход за животными',stat:'wis'},insight:{name:'Проницательность',stat:'wis'},medicine:{name:'Медицина',stat:'wis'},perception:{name:'Внимательность',stat:'wis'},survival:{name:'Выживание',stat:'wis'},deception:{name:'Обман',stat:'cha'},intimidation:{name:'Запугивание',stat:'cha'},performance:{name:'Выступление',stat:'cha'},persuasion:{name:'Убеждение',stat:'cha'}
};
const scores = z.object(Object.fromEntries(stats.map(s=>[s,z.number().int().min(3).max(20)])) as Record<typeof stats[number],z.ZodNumber>);
export const characterSchema = z.object({
  name:z.string().trim().min(1).max(80),classId:z.enum(classIds),level:z.number().int().min(1).max(20),ancestry:z.string().max(80).default('Человек'),background:z.string().max(100).default('Странник'),scores,
  proficientSkills:z.array(z.string()).max(18).default([]),hp:z.number().int().min(0).max(1000),tempHp:z.number().int().min(0).max(1000).default(0),armor:z.enum(['none','leather','chain','plate']).default('none'),shield:z.boolean().default(false),spentSlots:z.record(z.string(),z.number().int().min(0).max(10)).default({}),prepared:z.array(z.string()).max(100).default([]),notes:z.string().max(12000).default(''),
  edition:z.enum(['srd-2014','srd-2024','custom']).default('srd-2014'),rulesBase:z.enum(['srd-2014','srd-2024']).default('srd-2014'),theme:z.enum(['standard','blue','festival','horror','winter']).default('standard'),subclass:z.string().max(150).default(''),
  inventory:z.string().max(12000).default(''),feats:z.array(z.string().max(200)).max(50).default([]),expertise:z.array(z.string()).max(18).default([]),
  customClass:z.object({name:z.string().max(80),hitDie:z.number().int().min(4).max(20),ability:z.enum(stats),caster:z.enum(['none','full','half','pact'])}).default({name:'Свой класс',hitDie:8,ability:'int',caster:'none'}),
  customSpells:z.array(z.object({id:z.string().min(1).max(100),name:z.string().min(1).max(120),level:z.number().int().min(0).max(9),kind:z.enum(['attack','save','auto','heal','utility']),dice:z.string().max(30).optional(),save:z.string().max(40).optional(),text:z.string().max(12000)})).max(100).default([]),
  customFeatures:z.array(z.object({id:z.string().min(1).max(100),name:z.string().min(1).max(120),level:z.number().int().min(1).max(20),text:z.string().max(12000)})).max(100).default([])

});
export type Character = z.infer<typeof characterSchema>;
export const mod=(n:number)=>Math.floor((n-10)/2);
export const signed=(n:number)=>n>=0?`+${n}`:String(n);
export const proficiency=(level:number)=>2+Math.floor((level-1)/4);
export const classInfo=(c:Character)=>c.classId==='custom'?{...classes.custom,...c.customClass}:classes[c.classId];
export const maxHp=(c:Character)=>Math.max(1,classInfo(c).hitDie+mod(c.scores.con))+(c.level-1)*Math.max(1,classInfo(c).hitDie/2+1+mod(c.scores.con));
export const armorClass=(c:Character)=>(c.armor==='none'?10+mod(c.scores.dex)+(c.classId==='monk'&&!c.shield?Math.max(0,mod(c.scores.wis)):c.classId==='barbarian'?Math.max(0,mod(c.scores.con)):0):c.armor==='leather'?11+mod(c.scores.dex):c.armor==='chain'?16:18)+(c.shield?2:0);
export const slotsTable = [[],[2],[3],[4,2],[4,3],[4,3,2],[4,3,3],[4,3,3,1],[4,3,3,2],[4,3,3,3,1],[4,3,3,3,2],[4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1,1],[4,3,3,3,3,1,1,1,1],[4,3,3,3,3,2,1,1,1],[4,3,3,3,3,2,2,1,1]];
export const slotMax=(c:Character)=>{const caster=classInfo(c).caster;if(caster==='full')return slotsTable[c.level];if(caster==='half')return baseEdition(c)==='srd-2024'?slotsTable[Math.ceil(c.level/2)]:c.level===1?[]:slotsTable[Math.ceil(c.level/2)];if(caster==='pact'){const circle=Math.min(5,Math.ceil(c.level/2));return Array.from({length:circle},(_,i)=>i===circle-1?(c.level===1?1:c.level<11?2:c.level<17?3:4):0);}return [];};
export const spellModifier=(c:Character)=>mod(c.scores[classInfo(c).ability]);
export const spellDC=(c:Character)=>8+proficiency(c.level)+spellModifier(c);
export const features = [
  {id:'second-wind',classId:'fighter',level:1,name:'Второе дыхание',text:'Бонусным действием восстановите 1d10 + уровень воина хитов. Один раз между короткими или продолжительными отдыхами.'},
  {id:'action-surge',classId:'fighter',level:2,name:'Всплеск действий',text:'Одно дополнительное действие в свой ход. Использование восстанавливается после отдыха.'},
  {id:'extra-attack',classId:'fighter',level:5,name:'Дополнительная атака',text:'Две атаки вместо одной, когда совершаете действие Атака.'},
  {id:'sneak',classId:'rogue',level:1,name:'Скрытая атака',text:'Один раз за ход дополнительный урон при соблюдении условий скрытой атаки: ceil(уровень / 2)d6.'},
  {id:'cunning',classId:'rogue',level:2,name:'Хитрое действие',text:'Рывок, Отход или Засада бонусным действием.'},
  {id:'uncanny',classId:'rogue',level:5,name:'Невероятное уклонение',text:'Реакцией уменьшите вдвое урон видимой атаки по вам.'},
  {id:'arcane',classId:'wizard',level:1,name:'Магическое восстановление',text:'После короткого отдыха восстановите ячейки суммарным уровнем до ceil(уровень / 2), не выше 5-го круга. Один раз в день.'},
  {id:'channel',classId:'cleric',level:2,name:'Божественный канал',text:'Изгнание нежити: действие, спасбросок Мудрости против вашей Сл заклинаний. Подробные условия — в правилах.'}
];
export type Spell = {id:string;name:string;level:number;classes:ClassId[];kind:'attack'|'save'|'auto'|'heal'|'utility';dice?:string;up?:string;save?:string;text:string;data?:any};
export const spells:Spell[] = [
  {id:'fire-bolt',name:'Огненный снаряд',level:0,classes:['wizard'],kind:'attack',dice:'1d10',text:'Дальняя атака заклинанием, огонь. Урон растёт на уровнях 5, 11 и 17.'},
  {id:'ray-frost',name:'Луч холода',level:0,classes:['wizard'],kind:'attack',dice:'1d8',text:'Дальняя атака заклинанием. Скорость цели уменьшается на 10 футов до вашего следующего хода.'},
  {id:'sacred-flame',name:'Священное пламя',level:0,classes:['cleric'],kind:'save',save:'Ловкость',dice:'1d8',text:'При провале спасброска — урон излучением. Укрытие не даёт преимущества.'},
  {id:'light',name:'Свет',level:0,classes:['wizard','cleric'],kind:'utility',text:'Предмет излучает яркий свет на 20 футов и тусклый ещё на 20 футов, до 1 часа.'},
  {id:'magic-missile',name:'Волшебная стрела',level:1,classes:['wizard'],kind:'auto',dice:'3d4+3',up:'1d4+1',text:'Три автоматически попадающих дротика. При распределении по целям бросьте урон каждого дротика отдельно.'},
  {id:'shield',name:'Щит',level:1,classes:['wizard'],kind:'utility',text:'Реакция: +5 к КД до начала вашего следующего хода, включая вызвавшую реакцию атаку.'},
  {id:'cure',name:'Лечение ран',level:1,classes:['cleric'],kind:'heal',dice:'1d8',up:'1d8',text:'Касание. Лечение 1d8 + модификатор Мудрости. Не действует на нежить и конструктов.'},
  {id:'healing-word',name:'Лечащее слово',level:1,classes:['cleric'],kind:'heal',dice:'1d4',up:'1d4',text:'Бонусное действие. Лечение 1d4 + модификатор Мудрости на расстоянии 60 футов.'},
  {id:'guiding',name:'Направляющий снаряд',level:1,classes:['cleric'],kind:'attack',dice:'4d6',up:'1d6',text:'Дальняя атака заклинанием. Следующая атака по цели до конца вашего следующего хода имеет преимущество.'},
  {id:'scorching',name:'Палящий луч',level:2,classes:['wizard'],kind:'attack',dice:'2d6',up:'2d6',text:'Три луча; отдельная атака и 2d6 огнём для каждого. Более высокая ячейка добавляет луч.'},
  {id:'spiritual',name:'Божественное оружие',level:2,classes:['cleric'],kind:'attack',dice:'1d8',text:'Бонусное действие: рукопашная атака заклинанием, урон 1d8 + Мудрость. Урон растёт на 1d8 за каждые 2 круга ячейки выше второго.'},
  {id:'fireball',name:'Огненный шар',level:3,classes:['wizard'],kind:'save',save:'Ловкость',dice:'8d6',up:'1d6',text:'Сфера радиусом 20 футов. При успехе спасброска — половина урона, при провале — полный.'},
  {id:'spirit',name:'Духовные стражи',level:3,classes:['cleric'],kind:'save',save:'Мудрость',dice:'3d8',up:'1d8',text:'Концентрация, до 10 минут. Радиус 15 футов. При успехе спасброска — половина урона.'}
];
const aliases:Record<string,string>={'ray-of-frost':'ray-frost','cure-wounds':'cure','guiding-bolt':'guiding','scorching-ray':'scorching','spiritual-weapon':'spiritual','spirit-guardians':'spirit'};
export const availableSpells=(c:Character):Spell[]=>{const max=slotMax(c);const rows=sourceSpells.filter(x=>x.document.key===baseEdition(c)&&x.classes.some((v:any)=>v.name.toLowerCase()===c.classId)&&(x.level===0?classInfo(c).caster!=='none'&&classInfo(c).caster!=='half':!!max[x.level-1])).map(x=>{const rawId=x.key.split('_').slice(1).join('_'),id=aliases[rawId]||rawId,old=spells.find(s=>s.id===id);const kind:Spell['kind']=x.attack_roll?'attack':x.saving_throw_ability?'save':['cure','healing-word','heal','mass-healing-word','mass-cure-wounds','healing-spirit'].includes(id)?'heal':x.damage_roll?'auto':'utility';return {id,name:old?.name||x.name,level:x.level,classes:[c.classId],kind,up:old?.up,dice:(typeof x.damage_roll==='string'&&/^\d+d(4|6|8|10|12|20|100)([+-]\d+)?$/.test(x.damage_roll.replace(/\s/g,''))?x.damage_roll.replace(/\s/g,''):old?.dice),save:x.saving_throw_ability,text:x.desc+(x.higher_level?'\n\n'+x.higher_level:''),data:x} as Spell;});return [...rows,...c.customSpells.filter(s=>s.level===0||!!max[s.level-1]).map(s=>({...s,classes:[c.classId]}))];};
export function die(sides:number):number {
  const max=0x100000000,limit=max-max%sides; let value:number;
  do {value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=limit);
  return value%sides+1;
}
export function roll(formula:string,rng=die){
  const m=/^(\d{1,2})d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/.exec(formula.replace(/\s/g,''));
  if(!m||+m[1]<1||+m[1]>40)throw new Error('Формат броска: 2d6+3, максимум 40 кубиков');
  const dice=Array.from({length:+m[1]},()=>rng(+m[2])); const bonus=Number(m[3]||0);
  return {dice,bonus,total:dice.reduce((a,b)=>a+b,0)+bonus,formula};
}
export function check(bonus:number,mode:'normal'|'advantage'|'disadvantage'='normal',rng=die){const dice=Array.from({length:mode==='normal'?1:2},()=>rng(20));const natural=mode==='disadvantage'?Math.min(...dice):Math.max(...dice);return {dice,natural,total:natural+bonus,bonus};}
export function cast(c:Character,spellId:string,circle:number,mode:'normal'|'advantage'|'disadvantage'='normal'){
  const spell=availableSpells(c).find(s=>s.id===spellId);if(!spell)throw Error('Заклинание пока недоступно');
  if(spell.level>0&&!c.prepared.includes(spellId))throw Error('Сначала подготовьте заклинание');
  if(spell.level>0&&(circle<spell.level||!slotMax(c)[circle-1]||(c.spentSlots[circle]||0)>=slotMax(c)[circle-1]))throw Error('Нет доступной ячейки этого круга');
  const extra=spell.level?circle-spell.level:0;
  const scaling=spell.level===0?(c.level>=17?4:c.level>=11?3:c.level>=5?2:1):1;
  let formula=spell.id==='eldritch-blast'?'1d10':spell.dice?.replace(/^1d/,`${scaling}d`);
  if(spell.data){const options=spell.data.casting_options||[];const option=spell.level?options.find((x:any)=>x.type===`slot_level_${circle}`):options.filter((x:any)=>/^player_level_/.test(x.type)&&Number(x.type.split('_').pop())<=c.level).sort((a:any,b:any)=>Number(b.type.split('_').pop())-Number(a.type.split('_').pop()))[0];if(option?.damage_roll)formula=option.damage_roll;}
  if(baseEdition(c)==='srd-2024'&&spell.kind==='heal'&&['cure','healing-word'].includes(spell.id))formula=`${circle*2}d${spell.id==='cure'?8:4}`;
  if(spell.id==='magic-missile')formula=`${3+extra}d4+${3+extra}`;
  else if(spell.id==='spiritual'&&baseEdition(c)==='srd-2014')formula=`${1+Math.floor(extra/2)}d8`;
  else if(baseEdition(c)==='srd-2014'&&extra&&spell.up&&spell.id!=='scorching'&&formula){const base=/^(\d+)d(\d+)/.exec(formula)!,up=/^(\d+)d/.exec(spell.up)!;formula=`${+base[1]+extra*(+up[1])}d${base[2]}`;}
  const rayCount=spell.id==='scorching'?3+extra:spell.id==='eldritch-blast'?(c.level>=17?4:c.level>=11?3:c.level>=5?2:1):1;
  if(formula&&!/^(\d{1,2})d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/.test(formula))formula=undefined;
  const results=Array.from({length:rayCount},()=>{const attack=spell.kind==='attack'?check(proficiency(c.level)+spellModifier(c),mode):undefined;let damage=formula?roll(attack?.natural===20?formula.replace(/^(\d+)d/,(_,n)=>`${+n*2}d`):formula):undefined;if(damage&&(spell.kind==='heal'||spell.id==='spiritual'))damage={...damage,total:Math.max(0,damage.total+spellModifier(c)),bonus:damage.bonus+spellModifier(c)};return {attack,damage};});
  return {spell,results,dc:spellDC(c),character:{...c,spentSlots:spell.level?{...c.spentSlots,[circle]:(c.spentSlots[circle]||0)+1}:c.spentSlots}};
}
export const defaultCharacter=(classId:ClassId='wizard'):Character=>{const c=characterSchema.parse({name:classId==='wizard'?'Элиан':classId==='fighter'?'Бран':classId==='cleric'?'Мира':'Тень',classId,level:1,ancestry:'Человек',background:'Странник',scores:{str:10,dex:14,con:14,int:classId==='wizard'?16:12,wis:classId==='cleric'?16:12,cha:10},proficientSkills:[],hp:1,tempHp:0,armor:'none',shield:false,spentSlots:{},prepared:classId==='wizard'?['magic-missile','shield']:classId==='cleric'?['cure','guiding']:[],notes:''});if(classId==='fighter')c.scores.str=16;if(classId==='rogue')c.scores.dex=16;c.hp=maxHp(c);return c;};
export const bookingSchema=z.object({format:z.enum(['online','offline','surprise']),players:z.number().int().min(1).max(6),age:z.enum(['adults','children','surprise']),hours:z.number().int().min(2).max(8),experience:z.enum(['none','little','medium','expert','surprise']),rules:z.enum(['base','simple','very-simple','surprise']),characters:z.enum(['ready','custom','self','surprise']),characterDetails:z.string().max(2000).default(''),genres:z.array(z.string().max(50)).max(15),mood:z.string().max(150),settings:z.array(z.string().max(80)).max(15),extras:z.array(z.enum(['chronicle','video','miniatures'])).max(3),wishes:z.string().max(5000),start:z.string().datetime().optional(),alternatives:z.string().max(1000).default(''),name:z.string().trim().min(1).max(80),channel:z.enum(['telegram','email','phone']),contact:z.string().trim().min(3).max(150),consent:z.literal(true)}).superRefine((b,ctx)=>{if(b.channel==='email'&&!z.string().email().safeParse(b.contact).success)ctx.addIssue({code:'custom',path:['contact'],message:'Укажите email'});if(b.channel==='phone'&&!/^[+\d\s()-]{7,25}$/.test(b.contact))ctx.addIssue({code:'custom',path:['contact'],message:'Укажите телефон'});});
export const rulePackSchema=z.object({name:z.string().min(1).max(100),edition:z.enum(['srd-2014','srd-2024','custom']),description:z.string().max(5000).default(''),spells:characterSchema.shape.customSpells,features:characterSchema.shape.customFeatures});
export type Booking=z.infer<typeof bookingSchema>;
export const defaultPricing={hour:2000,extraPlayer:500,offline:1500,customCharacter:500,chronicle:2500,video:1500,miniatures:800};
export type Pricing=typeof defaultPricing;
export function price(b:Pick<Booking,'hours'|'players'|'format'|'characters'|'extras'>,p:Pricing=defaultPricing){const rows=[{name:`Игра, ${b.hours} ч`,amount:b.hours*p.hour}];if(b.players>4)rows.push({name:'Игроки сверх четырёх',amount:(b.players-4)*p.extraPlayer});if(b.format==='offline')rows.push({name:'Выезд мастера',amount:p.offline});if(b.characters==='custom')rows.push({name:'Подготовка персонажей',amount:b.players*p.customCharacter});for(const e of new Set(b.extras))rows.push({name:{chronicle:'Хроника приключения',video:'Видеозапись',miniatures:'Миниатюры'}[e],amount:p[e]*(e==='miniatures'?b.players:1)});return {rows,total:rows.reduce((s,r)=>s+r.amount,0)};}
export function overlaps(a:string,b:string,c:string,d:string){return Date.parse(a)<Date.parse(d)&&Date.parse(b)>Date.parse(c);}
export function ics(title:string,start:string,end:string,id:string){const esc=(v:string)=>v.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const date=(v:string)=>new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Questbook//RU','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${id}@questbook`,`DTSTAMP:${date(new Date().toISOString())}`,`DTSTART:${date(start)}`,`DTEND:${date(end)}`,`SUMMARY:${esc(title)}`,'BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:Скоро игра','END:VALARM','END:VEVENT','END:VCALENDAR'];return lines.map(line=>{let parts:string[]=[],chunk='';for(const ch of line){if(new TextEncoder().encode(chunk+ch).length>73){parts.push(chunk);chunk=' '+ch;}else chunk+=ch;}parts.push(chunk);return parts.join('\r\n');}).join('\r\n')+'\r\n';}

export function localId(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
