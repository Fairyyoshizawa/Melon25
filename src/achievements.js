// エンドレスモード専用の実績定義。
// survival 系は未解除でも条件を表示し、special 系は解除するまで「？？？」で隠す。

export const ACHIEVEMENTS = [
  { id: 'day10', name: '十日を超えた者', desc: 'エンドレスモードで10日間生き残る', hidden: false },
  { id: 'day30', name: '一か月前の俺', desc: 'エンドレスモードで30日間生き残る', hidden: false },
  { id: 'day50', name: '半世紀の昨日', desc: 'エンドレスモードで50日間生き残る', hidden: false },
  { id: 'day100', name: '昨日っていつだ？', desc: 'エンドレスモードで100日間生き残る', hidden: false },
  { id: 'noDamage', name: '無傷の今日', desc: 'エコーをノーダメージで倒す', hidden: true },
  { id: 'noAbility', name: '能力なんていらない', desc: '能力を一度も使わずにエコーを倒す', hidden: true },
  { id: 'parry5', name: 'それ、知ってる', desc: 'エコーの攻撃を5回連続でパリィする', hidden: true },
  { id: 'dodgeDash3', name: '昨日の癖', desc: 'エコーの《瞬歩》攻撃を3回連続で回避する', hidden: true },
  { id: 'reflectKill', name: '全部返す', desc: '《反射》によるダメージでエコーにとどめを刺す', hidden: true },
  { id: 'timestopKill', name: '1秒あれば十分', desc: '《時止め》発動中にエコーを倒す', hidden: true },
  { id: 'mirrorAfterimage', name: '残像対残像', desc: 'エコーとほぼ同時に《残像》を発動する', hidden: true },
  { id: 'flameKill', name: '炎の昨日', desc: '《炎刃》による攻撃でエコーにとどめを刺す', hidden: true },
  { id: 'allFive', name: 'もう一人の達人', desc: '5つの能力すべてを1回以上使ったエコーを倒す', hidden: true },
];

export const SURVIVAL_THRESHOLDS = [
  { id: 'day10', days: 10 },
  { id: 'day30', days: 30 },
  { id: 'day50', days: 50 },
  { id: 'day100', days: 100 },
];

export function getAchievement(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}
