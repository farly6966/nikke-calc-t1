/**
 * 효과 키의 표시 이름(번체 중국어).
 *
 * 계산 엔진은 효과를 `atk_dmg_pct` 같은 영어 키로 다룬다 — 스킬 텍스트를 파싱한
 * 결과라 이름이 하나로 고정돼야 하기 때문이다. 다만 화면에 그대로 내보이면
 * «무슨 뜻인지 모를 글자»가 된다. 여기서 그 키를 사람이 읽는 말로 바꾼다.
 *
 * 모르는 키는 **키를 그대로 돌려준다**. 새 캐릭터가 들어와 못 보던 효과가 붙어도
 * 빈칸이 되는 대신 영어로라도 남는다 — 없는 것보다 낫다.
 *
 * 용어는 `docs/hanhua-glossary.md`를 따른다. buff/debuff는 커뮤니티 관행대로
 * 영어를 그대로 쓴다(`ui.ts`와 같다).
 */

/** 값 뒤에 붙는 단위. 퍼센트 포인트인 키가 대부분이고, 몇 개만 초를 쓴다. */
const SECONDS = new Set([
  'burst_cooldown', 'burst_cooldown_reduce', 'fullburst_duration', 'charge_time_fixed',
  'charge_time_flat', 'reload_time_fixed', 'effect_interval', 'named_buff_duration_extend',
]);

/** `_pct`로 끝나지 않지만 퍼센트 포인트인 키. */
const PERCENT = new Set(['crit_rate', 'crit_dmg', 'normal_atk_crit_rate', 'received_dmg']);

export const STAT_NAMES: Record<string, string> = {
  accumulate_max_scale_pct: '累積上限倍率',
  accuracy_pct: '命中率',
  ammo_charge_flat: '裝彈補充',
  ammo_charge_pct: '裝彈補充',
  armor_break_damage: '破甲傷害',
  armor_break_dmg_pct: '破甲傷害增加',
  armor_break_enabled: '賦予破甲',
  atk_buff_mag_pct: '攻擊力 buff 增幅',
  atk_caster_based_pct: '攻擊力增加(依施放者)',
  atk_copy: '複製攻擊力',
  atk_dmg_pct: '造成傷害增加',
  atk_flat: '攻擊力增加(固定值)',
  atk_from_hp_pct: '依最大 HP 比例的攻擊力',
  atk_pct: '攻擊力增加',
  attack_speed_pct: '攻擊速度',
  auto_damage: '自動傷害',
  bonus_damage: '追加傷害',
  buff_max_stack_add: 'buff 最大疊層增加',
  buff_stack_add: '增加 buff 疊層',
  buff_stack_init: 'buff 疊層初始化',
  buff_stack_remove: '移除 buff 疊層',
  burst_charge_pct: '爆裂量表充能',
  burst_charge_speed_pct: '爆裂量表充能速度',
  burst_cooldown: '爆裂冷卻',
  burst_cooldown_reduce: '爆裂冷卻減少',
  burst_damage: '爆裂傷害',
  burst_dmg_aoe_pct: '爆裂範圍傷害增加',
  burst_dmg_pct: '爆裂傷害增加',
  burst_reentry: '爆裂再進入',
  charge_dmg_mag_pct: '蓄力傷害倍率增幅',
  charge_dmg_pct: '蓄力傷害增加',
  charge_dmg_per_max_ammo_pct: '每最大裝彈的蓄力傷害',
  charge_speed_buff_immune: '蓄力速度 buff 免疫',
  charge_speed_caster_based_pct: '蓄力速度(依施放者)',
  charge_speed_debuff_immune: '蓄力速度 debuff 免疫',
  charge_speed_overflow_conversion_pct: '超額蓄力速度轉換',
  charge_speed_pct: '蓄力速度',
  charge_time_fixed: '蓄力時間固定',
  charge_time_flat: '蓄力時間增減',
  core_damage: '核心傷害',
  core_dmg_pct: '核心傷害增加',
  cover_def_pct: '掩護物防禦力',
  cover_disabled: '無法掩護',
  cover_heal_from_caster_max_hp_pct: '掩護物回復(依施放者最大 HP 比例)',
  cover_heal_pct: '掩護物回復',
  cover_hp_caster_based_pct: '掩護物 HP(依施放者)',
  cover_max_hp_caster_based_pct: '掩護物最大 HP(依施放者)',
  cover_received_dmg_split: '掩護物傷害分攤',
  cover_revive: '掩護物再生',
  crit_dmg: '暴擊傷害',
  crit_rate: '暴擊率',
  current_hp_reduce: '現有 HP 減少',
  damage: '傷害',
  damage_accumulate: '傷害累積',
  damage_accumulate_ratio_pct: '傷害累積比例',
  debuff_cleanse: '解除 debuff',
  debuff_immune: 'debuff 免疫',
  debuff_stack_add: '增加 debuff 疊層',
  debuff_stack_remove: '移除 debuff 疊層',
  decoy: '誘餌',
  decoy_from_max_hp_pct: '誘餌 HP(依最大 HP 比例)',
  decoy_heal_from_caster_max_hp_pct: '誘餌回復(依施放者最大 HP 比例)',
  def_caster_based_pct: '防禦力增加(依施放者)',
  def_ignore_pct: '無視防禦力',
  def_pct: '防禦力增加',
  dmg_scale_mag_pct: '傷害倍率增幅',
  dot_damage: '持續傷害',
  dot_dmg_pct: '持續傷害增加',
  effect_interval: '效果間隔',
  effect_range_pct: '效果範圍',
  effect_target_count_add: '效果目標數增加',
  element_bonus: '剋制代碼傷害',
  element_bonus_pct: '剋制代碼傷害',
  element_code_override: '代碼變更',
  element_received_dmg_pct: '代碼承受傷害增加',
  enemy_buff_cleanse: '解除敵方 buff',
  enemy_def_down_pct: '敵方防禦力減少',
  enemy_movement_disable: '敵人無法移動',
  explosion_range: '爆炸範圍',
  feather_refresh: '羽毛再充能',
  fixed_damage_from_dealt_pct: '依造成傷害比例的固定傷害',
  focus_fire: '集中射擊',
  force_move: '強制移動',
  force_reload: '強制裝填',
  force_skill_use: '強制使用技能',
  fullburst_duration: '全爆裂時間',
  gauge_charge: '量表充能',
  gauge_charge_enabled: '可充能量表',
  gauge_consume: '量表消耗',
  gauge_consume_as_ammo: '以量表代替彈藥消耗',
  gauge_max_add: '量表上限增加',
  harmful_immune_count: '有害效果免疫次數',
  heal_equal_split: '回復均等分配',
  heal_given_pct: '給予回復量',
  heal_hp_pct: 'HP 回復',
  heal_overcharge_discharge: '過充能回復釋放',
  heal_overcharge_store: '過充能回復儲存',
  heal_overcharge_store_atk_pct: '過充能儲存(依攻擊力比例)',
  heal_received_pct: '受到回復量',
  heal_split: '回復分配',
  hp_caster_based_pct: 'HP 回復(依施放者)',
  hp_copy: '複製 HP',
  hp_only_caster_based_pct: 'HP 增加(依施放者)',
  indomitable: '不屈',
  infinite_ammo: '無限彈藥',
  intercept_dmg_pct: '攔截傷害增加',
  invincible: '無敵',
  lifesteal_pct: '吸血',
  lock_on: '鎖定',
  max_ammo_flat: '最大裝彈數增加',
  max_ammo_infinite: '最大裝彈無限',
  max_ammo_pct: '最大裝彈數',
  max_hp_only_pct: '最大 HP 增加',
  max_hp_pct: '最大 HP',
  mg_warmup_speed_pct: 'MG 預熱速度',
  named_buff_duration_extend: '指定 buff 持續時間延長',
  next_shield_hp_pct: '下次護盾 HP',
  normal_atk_crit_rate: '普攻暴擊率',
  normal_atk_dmg_pct: '普攻傷害增加',
  optimal_range_max_pct: '最佳射程上限',
  optimal_range_min: '最佳射程下限',
  outgoing_heal_pct: '給予回復量',
  part_dmg_pct: '部位傷害增加',
  pellet_count: '彈丸數',
  pellet_count_fixed: '彈丸數固定',
  persona_state: '人格狀態',
  pierce_dmg_pct: '穿透傷害增加',
  pierce_enabled: '賦予穿透',
  pierce_range: '穿透範圍',
  possessed: '附身',
  projectile_attachment_damage: '附著投射物傷害',
  projectile_attachment_dmg: '投射物附著傷害',
  projectile_attachment_dmg_pct: '附著投射物傷害增加',
  projectile_dmg_pct: '投射物傷害增加',
  projectile_explosion_damage: '投射物爆炸傷害',
  projectile_explosion_dmg: '投射物爆炸傷害',
  projectile_explosion_dmg_pct: '投射物爆炸傷害增加',
  received_dmg: '敵人承受傷害增加',
  received_dmg_pct: '承受傷害增加',
  received_dmg_split: '承受傷害分攤',
  reload_speed_pct: '裝填速度',
  reload_time_fixed: '裝填時間固定',
  remove_named_buff: '移除指定 buff',
  revive: '復活',
  sequential_dmg_pct: '連續傷害增加',
  shared_shield_from_max_hp_pct: '共用護盾(依最大 HP 比例)',
  shield_dmg_pct: '護盾傷害增加',
  shield_from_max_hp_pct: '護盾(依最大 HP 比例)',
  shield_heal_from_caster_max_hp_pct: '護盾回復(依施放者最大 HP 比例)',
  shield_invincible: '護盾無敵',
  skill_cooldown_pct: '技能冷卻',
  skill_cooldown_reduce_pct: '技能冷卻減少',
  split_damage: '分裂傷害',
  split_dmg_pct: '分裂傷害增加',
  squad_ammo_consume_as: '隊友彈藥消耗替代',
  stealth: '隱身',
  stun: '暈眩',
  stun_immune: '暈眩免疫',
  targeting_exclude: '排除目標',
  taunt: '嘲諷',
  trigger_count_reduce: '發動次數減少',
  undying: '不死',
};

/** 효과 키의 표시 이름. 모르는 키는 그대로 돌려준다. */
export function statName(stat: string): string {
  return STAT_NAMES[stat] ?? stat;
}

/**
 * 「이름 +값단위」 한 줄. 값이 없으면 이름만 준다.
 *
 * 퍼센트로 다루는 수치가 대부분이라 `_pct`로 끝나면 %를 붙이고, 쿨타임·지속처럼
 * 시간을 담는 몇 개만 초를 붙인다. 나머지는 단위 없이 숫자만 적는다.
 */
export function statText(stat: string, value?: number | null): string {
  const name = statName(stat);
  if (typeof value !== 'number' || !Number.isFinite(value)) return name;
  const unit = SECONDS.has(stat) ? '秒' : (stat.endsWith('_pct') || PERCENT.has(stat) ? '%' : '');
  const rounded = Math.round(value * 100) / 100;
  return `${name} ${rounded > 0 ? '+' : ''}${rounded}${unit}`;
}
