/**
 * 导演预设库：叙事结构 / 镜头配方 / 人物卡
 *
 * 三者的分工：
 *   叙事结构 —— 决定「讲什么、按什么顺序讲」，把 N 个镜头映射到节拍上；
 *   镜头配方 —— 决定「怎么拍」，给出开场/中段/收尾的景别与运镜；
 *   人物卡   —— 决定「谁在演」，把外观拆成必须逐段复述的字段。
 * 视觉风格（styles.js）决定「看起来像什么」，四者互不重叠。
 */

/* ---------------------------- 叙事结构 ---------------------------- */

export const STORY_STRUCTURES = [
  {
    id: 'hook_first',
    label: '钩子优先',
    note: '信息流与短视频，前 3 秒定生死',
    beats: [
      { label: '钩子', weight: 0.2, intent: '第一秒就抛出冲突、悬念或反常识画面，不要铺垫环境' },
      { label: '铺垫', weight: 0.3, intent: '交代人物、场景与处境，让观众理解上下文' },
      { label: '转折', weight: 0.3, intent: '局面发生变化或揭示新信息，制造情绪起伏' },
      { label: '收尾', weight: 0.2, intent: '给出情绪落点，画面停在有余味的位置' },
    ],
  },
  {
    id: 'product_three',
    label: '产品三段式',
    note: '电商、带货、上新',
    beats: [
      { label: '痛点', weight: 0.2, intent: '呈现用户真实困扰，画面要有代入感' },
      { label: '产品亮相', weight: 0.3, intent: '产品成为画面主体，材质、细节与卖点清晰可见' },
      { label: '使用场景', weight: 0.3, intent: '人物在真实场景中使用产品，动作自然' },
      { label: '结果', weight: 0.2, intent: '展示使用后的状态或效果，给出可信证据' },
    ],
  },
  {
    id: 'travel_narrative',
    label: '旅拍叙事',
    note: '文旅、目的地宣传、游记',
    beats: [
      { label: '大景开场', weight: 0.25, intent: '交代地理环境与整体氛围，建立空间感' },
      { label: '细节', weight: 0.25, intent: '呈现当地独有质感：食物、器物、纹理、声音' },
      { label: '人物', weight: 0.3, intent: '人物与环境互动，体现置身其中的感受' },
      { label: '空镜收尾', weight: 0.2, intent: '回到环境空镜，留下余韵' },
    ],
  },
  {
    id: 'emotional_arc',
    label: '情绪递进',
    note: '剧情短片、MV、情绪向内容',
    beats: [
      { label: '平静', weight: 0.25, intent: '克制的日常状态，画面偏静' },
      { label: '波动', weight: 0.25, intent: '出现扰动，动作与光线开始变化' },
      { label: '爆发', weight: 0.3, intent: '情绪最高点，动作幅度与镜头强度最大' },
      { label: '留白', weight: 0.2, intent: '回落，画面留出呼吸空间' },
    ],
  },
  {
    id: 'talking_head',
    label: '口播干货',
    note: '知识、教程、观点输出',
    beats: [
      { label: '提问', weight: 0.2, intent: '直接点名观众痛点，用一句话建立相关性' },
      { label: '拆解', weight: 0.5, intent: '分点展开论据，画面配合示意或场景' },
      { label: '总结', weight: 0.15, intent: '收束为一句可记住的结论' },
      { label: '行动号召', weight: 0.15, intent: '给出下一步动作暗示' },
    ],
  },
  {
    id: 'problem_solution',
    label: '痛点解决',
    note: '工具、教程、SaaS、方法论',
    beats: [
      { label: '问题呈现', weight: 0.3, intent: '把问题具象成可见的画面困境' },
      { label: '尝试与受阻', weight: 0.2, intent: '展示常规做法的低效或失败' },
      { label: '方案出现', weight: 0.3, intent: '新方法/工具登场，操作清晰' },
      { label: '结果验证', weight: 0.2, intent: '对比前后差异，形成说服力' },
    ],
  },
  {
    id: 'music_montage',
    label: 'MV 蒙太奇',
    note: '混剪、氛围片、节奏向内容',
    beats: [
      { label: '起拍', weight: 0.2, intent: '建立视觉基调与节奏感' },
      { label: '快切组', weight: 0.5, intent: '画面变化密集，景别与场景快速切换' },
      { label: '落版', weight: 0.3, intent: '节奏放缓，停在标志性画面上' },
    ],
  },
  {
    id: 'doc_observe',
    label: '纪实观察',
    note: '纪录片、人物跟拍、真实记录',
    beats: [
      { label: '环境交代', weight: 0.3, intent: '先让观众看清空间与氛围，不急着给人物' },
      { label: '人物行为', weight: 0.4, intent: '不干预地记录人物在做的事，保留真实停顿' },
      { label: '细节', weight: 0.2, intent: '手部、物件、表情等细节补充信息' },
      { label: '离开', weight: 0.1, intent: '人物走出画面或镜头缓缓退开' },
    ],
  },
];

/* ---------------------------- 镜头配方 ---------------------------- */

export const SHOT_RECIPES = [
  {
    id: 'classic_three',
    label: '经典三段',
    note: '通用性最强，结构感清晰',
    grammar: {
      open: '大远景，固定机位',
      middle: '中景，缓慢推近',
      close: '特写，固定机位',
    },
  },
  {
    id: 'stable',
    label: '稳定克制',
    note: '企业片、访谈、正片',
    grammar: {
      open: '中景，固定机位',
      middle: '中近景，极缓推近',
      close: '中景，固定机位',
    },
  },
  {
    id: 'handheld',
    label: '手持纪实',
    note: '纪实、vlog、真实感优先',
    grammar: {
      open: '中景，手持跟随',
      middle: '近景，手持轻微晃动',
      close: '中景，跟随并后拉',
    },
  },
  {
    id: 'orbit',
    label: '环绕展示',
    note: '产品、人物、空间展示',
    grammar: {
      open: '中景，环绕起步',
      middle: '近景，环绕中段',
      close: '特写，环绕收束',
    },
  },
  {
    id: 'aerial',
    label: '航拍大景',
    note: '风光、城市、宏大场面',
    grammar: {
      open: '大远景，航拍前推',
      middle: '远景，横向掠过',
      close: '大远景，拉升收尾',
    },
  },
  {
    id: 'macro',
    label: '微距细节',
    note: '美食、材质、工艺、美妆',
    grammar: {
      open: '特写，固定机位',
      middle: '大特写，极缓推近',
      close: '特写，轻微横移',
    },
  },
  {
    id: 'follow',
    label: '跟拍',
    note: '行走、运动、城市漫游',
    grammar: {
      open: '中景，背后跟拍',
      middle: '近景，侧面平行跟拍',
      close: '中景，超越后回头',
    },
  },
  {
    id: 'pov',
    label: '主观视角',
    note: '沉浸感、第一人称叙事',
    grammar: {
      open: '主观视角，平视前方',
      middle: '主观视角，双手入画',
      close: '主观视角，抬头仰望',
    },
  },
];

/* ----------------------------- 人物卡 ----------------------------- */

export const CHARACTER_CARDS = [
  {
    id: 'urban_female',
    label: '都市职场女性',
    note: '通勤、生活方式、职场题材',
    age: '28 岁',
    gender: '女性',
    temperament: '干练但带着疲惫感',
    hair: '黑色齐肩短发，发丝自然不僵硬',
    outfit: '米白色针织衫配深灰西装长裤',
    accessory: '细金属表带手表',
    vibe: '都市通勤气质，站姿利落',
  },
  {
    id: 'student',
    label: '校园女生',
    note: '青春、成长、校园题材',
    age: '20 岁',
    gender: '女性',
    temperament: '清澈略显腼腆',
    hair: '黑色长直发，齐刘海',
    outfit: '白衬衫配浅蓝牛仔背带裤',
    accessory: '帆布单肩包',
    vibe: '学生气，动作轻快',
  },
  {
    id: 'creator_male',
    label: '年轻创作男性',
    note: '数码、创作、都市青年',
    age: '26 岁',
    gender: '男性',
    temperament: '松弛而专注',
    hair: '微卷短发，略乱',
    outfit: '深灰连帽卫衣配工装裤',
    accessory: '有线耳机绕颈',
    vibe: '创作者气质，手指常带小动作',
  },
  {
    id: 'mature_male',
    label: '成熟男性',
    note: '商务、决策者、权威感',
    age: '40 岁',
    gender: '男性',
    temperament: '沉稳克制',
    hair: '短寸，鬓角微白',
    outfit: '深蓝衬衫配无领外套',
    accessory: '细框金属眼镜',
    vibe: '决策者气场，语速平缓',
  },
  {
    id: 'elder',
    label: '长者讲述者',
    note: '传承、回忆、人文题材',
    age: '65 岁',
    gender: '男性',
    temperament: '温和有故事感',
    hair: '花白短发，梳理整齐',
    outfit: '深灰中山装配布鞋',
    accessory: '木质手杖',
    vibe: '长辈气质，动作缓慢稳定',
  },
  {
    id: 'child',
    label: '儿童',
    note: '亲子、童趣、教育',
    age: '7 岁',
    gender: '女性',
    temperament: '好奇活泼',
    hair: '双马尾，发圈颜色明亮',
    outfit: '明黄卫衣配牛仔背带裙',
    accessory: '抱着小熊玩偶',
    vibe: '童真，动作幅度大',
  },
  {
    id: 'athlete',
    label: '运动型',
    note: '健身、户外、运动品牌',
    age: '27 岁',
    gender: '男性',
    temperament: '专注有力',
    hair: '短寸，额头有薄汗',
    outfit: '速干背心配运动短裤',
    accessory: '运动手表',
    vibe: '力量感，呼吸节奏明显',
  },
  {
    id: 'artisan',
    label: '手艺人',
    note: '工艺、非遗、匠人题材',
    age: '55 岁',
    gender: '男性',
    temperament: '沉静专注',
    hair: '灰白短发',
    outfit: '靛蓝围裙配素色长袖',
    accessory: '老花镜架在鼻梁',
    vibe: '手作感，手部细节丰富',
  },
];

/* ----------------------------- 取用与拼装 ----------------------------- */

export function getStoryStructure(id) {
  return STORY_STRUCTURES.find((item) => item.id === String(id || '').trim()) || null;
}

export function getShotRecipe(id) {
  return SHOT_RECIPES.find((item) => item.id === String(id || '').trim()) || null;
}

export function getCharacterCard(id) {
  return CHARACTER_CARDS.find((item) => item.id === String(id || '').trim()) || null;
}

/** 把节拍按权重映射到 N 个镜头 */
export function storyBaseline(story, shotCount) {
  if (!story) return '';
  const total = story.beats.reduce((sum, beat) => sum + beat.weight, 0) || 1;
  const lines = story.beats.map((beat, index) => {
    const share = Math.max(1, Math.round((beat.weight / total) * shotCount));
    return `${index + 1}. ${beat.label}（约 ${share} 个镜头）：${beat.intent}`;
  });
  return `叙事结构「${story.label}」——请把 ${shotCount} 个镜头按下列节拍顺序分配，权重只表示相对篇幅：\n${lines.join('\n')}`;
}

/** 开场/中段/收尾的景别与运镜 */
export function shotBaseline(recipe) {
  if (!recipe) return '';
  const { open, middle, close } = recipe.grammar;
  return [
    `镜头配方「${recipe.label}」：`,
    `- 开场镜头：${open}`,
    `- 中段镜头：${middle}`,
    `- 收尾镜头：${close}`,
  ].join('\n');
}

/** 人物卡拼成必须逐段复述的固定设定 */
export function characterBaseline(card) {
  if (!card) return '';
  return [
    '人物固定设定（每个镜头的提示词都必须原样复述以下外观，不得省略或改写）：',
    `- 年龄性别：${card.age}，${card.gender}`,
    `- 气质：${card.temperament}`,
    `- 发型：${card.hair}`,
    `- 服装：${card.outfit}`,
    `- 配饰：${card.accessory}`,
    `- 体态：${card.vibe}`,
  ].join('\n');
}

/** 供前端直接填入「人物设定」输入框的一行摘要 */
export function characterSummary(card) {
  if (!card) return '';
  return [
    card.age, card.gender, card.temperament,
    card.hair, card.outfit, card.accessory,
  ].join('，');
}
