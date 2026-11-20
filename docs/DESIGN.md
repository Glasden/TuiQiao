# 推敲 · 设计契约

「推敲」是一款由大模型出题的诗词小游戏。三个部件：

- **SKILL**（\`skill/tuiqiao/SKILL.md\`）：指导 harness 里的模型提问、创作、建局、评点。
- **CLI**（\`bin/tuiqiao.js\`，Node ≥ 18，零运行时依赖，ESM）：格律校验、建局、起停本地服务、等待玩家交卷、回写评点。
- **网页**（\`web/\`，纯静态，无构建步骤）：玩家读谜面（背景故事）、选难度、填词、看格律反馈、揭晓原作。

本文件是三方（韵律核心 / 服务与 CLI / 前端）共同遵守的接口契约。**字段名、取值一律以本文件为准。**

## 0. 目录与归属

| 路径 | 内容 | 归属 |
| --- | --- | --- |
| \`scripts/build-data.mjs\`、\`data/**\` | 韵书、词谱的构建脚本与产物 | 韵律核心 |
| \`src/prosody/**\`、\`test/prosody/**\` | 韵书查询、格律谱、校验器 | 韵律核心 |
| \`bin/**\`、\`src/cli/**\`、\`src/server/**\`、\`src/store/**\`、\`src/game/**\`、\`test/server/**\` | CLI、HTTP 服务、存储、对局逻辑 | 服务与 CLI |
| \`web/**\`、\`skill/**\`、\`docs/**\`、\`README.md\`、\`package.json\` | 前端、SKILL、文档 | 主会话 |

全部源码为 ESM（\`package.json\` 已有 \`"type": "module"\`）。测试用 \`node --test\`，不引入任何 npm 依赖。

## 1. 术语

- **句（ju）**：以词谱的「句 / 韵 / 读 / 叠 / 叶」标记切出的最小单位；近体诗的一句就是一个 ju。下标从 0 起，面向人的文案从 1 起。
- **格（cell）**：句中的一个字位，用 \`"j.i"\`（句下标.字下标）寻址。
- **阕**：词的分段；\`stanzaEnd: true\` 标在一阕的最后一句上（最后一阕也标）。诗视为一阕。
- **韵书（rhymebook）**：\`xinyun\` = 中华新韵（十四韵，阴平阳平为平，上去为仄，无入声）；\`guyun\` = 古韵（诗依平水韵，词依词林正韵，入声归仄）。
- **档（mode）**：六档由易到难为 \`ze\` 择字、\`bian\` 辨字、\`chai\` 拆篇（合称「选字」三档，\`group: 'xuan'\`，字从字盘里拣，见 §6.5）与 \`zi\` 填字、\`ju\` 补句、\`fu\` 自赋（合称「落笔」三档，\`group: 'xie'\`，字自己写）。选字三档与 zi 档一样是对着原作填空：**下文凡写「zi / ju 档」的规则，除 §6.5 另有说明外，选字三档同样适用。**
- **体裁种类（kind）**：\`shi\`（五绝 / 七绝 / 五律 / 七律）、\`ci\`（钦定词谱收录的词牌、曲牌）、\`free\`（谱库里没有的体裁，不校验格律）。

## 2. 韵律核心 \`src/prosody/index.js\`

全部为**同步**的具名导出；数据在首次调用时惰性加载（\`data/*.json\` 用 \`fs.readFileSync\` + 相对 \`import.meta.url\` 的路径读取）。

~~~js
export const RHYMEBOOKS = [
  { id: 'xinyun', name: '中华新韵', note: '依普通话读音，十四韵，无入声' },
  { id: 'guyun',  name: '平水韵 · 词林正韵', note: '诗依平水韵，词依词林正韵，入声归仄' },
];

listForms({ kind, commonOnly } = {})   // → FormSummary[]
sampleForms(n = 4, rng = Math.random)  // → FormSummary[]，从常用体裁里随机取 n 个，至少含 1 个诗体和 1 个词牌（n ≥ 2 时）
resolveForm(nameOrAlias)               // → FormDef | null（接受别名、「七言绝句」这类全称、带「·」后缀的写法）
charInfo(ch, rhymebook, kind = 'shi')  // → CharInfo
simplify(ch)                           // → string，繁体单字折成简体（data/simplified.json），无映射则原样
listRhymes(rhymebook, kind = 'shi')    // → RhymeSummary[]，该韵表的全部韵（§2.3）
rhymeChars(name, rhymebook, kind = 'shi', tone) // → RhymeChars[]，某韵部的字；tone 省略时该名下的平、仄各一条，查无此名为 []
bookName(rhymebook, kind = 'shi')      // → '中华新韵' | '平水韵' | '词林正韵'，实际查的那张韵表的名字
splitPoem(text)                        // → { ju: [{ text, punct }], stanzaBreaks: number[] }
checkPoem({ form, rhymebook, text, ju, variant = 'auto', partial = false }) // → Report
~~~

### 2.1 类型

~~~ts
FormSummary = { id: string, name: string, kind: 'shi'|'ci', chars: number, common: boolean,
                sketch: string,          // 一句话格式说明，如「双调四十二字，前段三句三平韵，后段三句两平韵」
                aliases: string[] }
FormDef     = { id, name, kind: 'shi'|'ci', desc: string, common: boolean, aliases: string[], variants: Variant[] }
Variant     = { index: number,           // 在 variants 里的下标
                label: string,           // 诗：「仄起首句入韵」等；词：「正体 · 韩偓」「变体二 · 薛昭蕴」
                sketch: string, chars: number, ju: JuPattern[] }
JuPattern   = { tones: string,           // 每字一个字符，取 '平' | '仄' | '中'，如 '中平中仄平平仄'
                end: '句'|'韵'|'读'|'叠'|'叶',
                rhyme: boolean,          // 句末字是否押韵（韵 / 叠 / 叶 为 true）
                rhymeGroup: number|null, // 同组须同韵部；换韵的词有多组，从 1 起
                rhymeTone: '平'|'仄'|null,
                stanzaEnd: boolean }
CharInfo    = { char: string, known: boolean,
                tones: ('平'|'仄')[],    // 去重；多音字可能两者都有；unknown 时为 []
                readings: [{ tone: '平'|'仄', sheng: string /* 阴平|阳平|上|去|入|平 */, rhyme: string /* 韵部名，如 '七阳' '一东' '第三部' */, pinyin?: string }] }
RhymeSummary = { name: string, tone: '平'|'仄', sheng: string[] /* 所含的声，如 ['上','去'] */,
                 chars: number /* 全部字数 */, common: number /* 其中常用字数 */ }
RhymeChars  = { name: string, tone: '平'|'仄',
                common: string,          // 常用字连成一串，依一级字表次序（即拼音序）
                rare: string }           // 其余的字，依码位序
Report      = { ok: boolean,             // 没有 error 级问题（partial 时只看已填的格）
                complete: boolean,       // 所有字位都已填
                form: { id, name, kind }, rhymebook: 'xinyun'|'guyun',
                variant: { index, label, sketch } | null,
                ju: [{ text: string, punct: string, end, rhyme, rhymeGroup, stanzaEnd,
                       cells: [{ char: string|null, want: '平'|'仄'|'中',
                                 got: ('平'|'仄')[],      // 该字可读的声调；未知字 / 空格为 []
                                 ok: boolean|null,        // null = 空格或 want 为中且无其它规则牵涉
                                 known: boolean }] }],
                rhymes: [{ group: number, tone: '平'|'仄', name: string|null /* 实际所押韵部 */, ok: boolean,
                           members: [{ ju: number, char: string|null, rhymes: string[] }] }],
                issues: [{ level: 'error'|'warn', code: string, ju: number|null, pos: number|null, message: string }],
                stats: { errors: number, warns: number } }
~~~

### 2.2 校验规则

- 输入二选一：\`text\`（带标点与换行的全文，用 \`splitPoem\` 切句；空行分阕）或 \`ju\`（字符串数组，按谱的句序对位，可含空串）。
- \`variant: 'auto'\`：在该体裁所有变体中选 error 最少者（并列取下标小者）；也可传下标固定某一变体。
- \`partial: true\`：容忍缺句、缺字；缺的格 \`char: null, ok: null\`，不因字数不足报错，只校验已有的字。**句内字符多于谱面时截断并报 \`length\` warn。**
- 多音字：只要有一个读音合律即算合（\`ok: true\`）。
- 未收录的字：\`known: false\`，不报 error，报一条 \`unknown-char\` warn。古韵查不到时先经繁→简映射再查，仍无则用普通话声调兜底（标 warn）。
- issue code：\`length\`（句数 / 字数不合）、\`tone\`（平仄不合）、\`rhyme\`（韵脚不押、出韵、韵脚平仄不对）、\`guping\`（孤平）、\`sanping\`（三平尾）、\`sanze\`（三仄尾，warn）、\`repeat-rhyme\`（重韵，warn）、\`die\`（叠句未叠，warn）、\`unknown-char\`（warn）、\`neighbor-rhyme\`（首句借邻韵，warn）。
- \`message\` 用中文，句、字序号从 1 起，能让模型据此改诗，例如：\`第2句第4字「春」应仄，实为平\`、\`第4句韵脚「乔」属二萧，与第2句「朝」同韵\`（后者不是 issue，仅示例措辞）。

**近体诗（shi）**：四种句型 A 仄仄平平仄、B 平平仄仄平、C 平平平仄仄、D 仄仄仄平平（七言在前面加两个相反的字）。每体四个变体：平起 / 仄起 × 首句入韵 / 不入韵，粘对关系由模板保证。放宽：A、C、D 的第一字（七言第一、三字）为「中」；B 型第一字（七言第三字）为「中」但须过孤平检查（仄平仄仄平 = error \`guping\`；仄平平仄平为拗救，合律）；C 型第三字（七言第五字）为「中」，作仄时报 \`sanze\` warn，并接受特拗 平平仄平仄；D 型第三字（七言第五字）固定为仄，作平即三平尾 error。韵脚须平声同韵部；首句入韵时首句可借邻韵（warn）。

**词（ci）**：按钦定词谱逐字对位；「中」不校验。韵脚分组：按谱面韵位的平仄把连续同声调的韵位划为一组，每组内须同韵部（古韵用词林正韵的部，上去通押，入声独立成部）；「叶」位与前一组同部而声调相反；「叠」位须与上一句文字相同（否则 \`die\` warn）并入前一组。

**自由体（free）**：\`resolveForm\` 返回 null 时，\`checkPoem({ form: '任意名字', ... })\` 仍须返回 Report：\`form.kind = 'free'\`，\`variant: null\`，句结构取自输入本身，所有 \`want\` 为「中」，\`issues\` 只可能有 \`unknown-char\`，\`rhymes\` 为空数组。

### 2.3 查韵

供出题模型（CLI \`char\` / \`rhymes\`）与网页的「查韵」共用。

- **韵表**由 \`(rhymebook, kind)\` 决定：\`xinyun\` → 中华新韵；\`guyun\` + \`ci\` → 词林正韵；\`guyun\` + \`shi\` / \`free\` → 平水韵。与 \`charInfo\` 的取表规则一致。
- **一个韵 = 韵部名 + 平仄**，即押韵时须相同的那个单位：
  - 新韵：十四个韵部各有平（阴平、阳平）、仄（上、去）两条。
  - 词林正韵：前十四部各有平、仄（上去通押，合为一条）两条；入声五部（第十五至十九部）只有仄一条。
  - 平水韵：一百零六韵各只一条，平声韵为平，上、去、入声韵为仄。
- \`listRhymes\` 依韵书次序列出，同名者先平后仄。
- **常用字**：该字在 \`data/common.json\`（GB2312 一级字表，3755 字，一个 JSON 字符串）里。有简体映射而与自身不同的繁体字（\`simplify(ch) !== ch\`）一律归入 \`rare\`，免得与简体重出。
- 多音字在它的每个读音所属的韵里各出现一次。

## 3. 对局文件（\`tuiqiao create <game.json>\` 的输入）

~~~jsonc
{
  "title": "赤壁",                       // 必填，诗题
  "subjects": ["周瑜", "赤壁之战"],      // 必填，玩家给出的人 / 事
  "premise": "history",                  // 必填：history = 依史实；alternate = 改写
  "premiseNote": "假如那夜东风未起",     // 选填，改写的方向
  "form": "七绝",                        // 必填，体裁名
  "rhymebook": "xinyun",                 // 必填：xinyun | guyun
  "story": "……",                         // 必填，谜面。纯文本，段落以空行分隔
  "poem": "折戟沉沙铁未销，自将磨洗认前朝。\n东风不与周郎便，铜雀春深锁二乔。", // 必填，谜底，带标点；词以空行分阕
  "cloze": "折戟沉沙【铁】未销，自将【磨洗】认前朝。\n……",  // 选填，填字档（及择字、辨字档）的挖空：与 poem 完全相同，只是把要挖的字用【】括起
  "decoys": "铜尚拭辨",                  // 选填，辨字档的干扰字：一串汉字（其它字符忽略），至多取前 12 个（§6.5）
  "hiddenLines": [2, 4],                 // 选填，补句档要藏的句（从 1 起）
  "glosses": ["……", "……", "……", "……"],  // 选填，逐句白话句意，长度须等于句数
  "imagery": ["东风", "折戟", "铜雀台"], // 选填，自赋档的意象提示，至多 8 条
  "note": "……"                           // 选填，创作手记，揭晓时展示
}
~~~

校验（任何一条不过都以 exit 1 结束，并在 stdout 的 JSON 里给出可据以修改的 \`errors\`）：必填项齐全；\`cloze\` 去掉【】后须与 \`poem\` 逐字相同；\`hiddenLines\` 在句数范围内且不得藏全部句；\`glosses\` 长度等于句数；\`decoys\` 须为文本；格律校验 \`checkPoem\` 有 error 时拒绝，除非带 \`--allow-flaws\`（此时把 issues 存进对局，揭晓时如实展示）。

对局里存 \`decoys: string[]\`（依次取出的汉字，去重，至多 12 个；没给则为 \`[]\`，旧对局没有此字段时同样视为空）。

缺省：无 \`cloze\` 时自动挖空（约三成字，每句至少一字，用对局 id 作种子保证可复现）；无 \`hiddenLines\` 时，诗藏偶数句，词与自由体隔句藏（第 2、4、6… 句）。

## 4. 存储

数据目录 \`$TUIQIAO_HOME\`，缺省 \`~/.tuiqiao\`：

- \`games/<id>.json\`：一局一个文件（id 为 6 位小写字母数字）。写入用「写临时文件 + rename」保证原子。
- \`server.json\`：\`{ pid, port, host, url, startedAt }\`；\`server.log\`。

服务与 CLI 通过文件共享状态：服务**每次请求都从磁盘读对局**，不做内存缓存，因此 CLI 直接写文件（建局、写评点）即可被网页看到。

## 5. CLI

可执行文件 \`bin/tuiqiao.js\`。约定：**stdout 只出结果，日志与进度走 stderr**；exit 0 成功，1 业务失败（校验不过、对局不存在等），2 用法错误，3 \`wait\` 超时仍未交卷。

| 命令 | 行为 | stdout |
| --- | --- | --- |
| \`forms [--sample N] [--kind shi\|ci] [--all] [--json]\` | 列体裁。缺省只列常用；\`--sample N\` 随机取 N 个常用体裁（给模型出选项用） | 文本，每行「名称　字数　一句话格式」；\`--json\` 出 FormSummary[] |
| \`form <名称> [--json]\` | 看某体裁的谱（全部变体，标出平仄与韵位） | 文本；\`--json\` 出 FormDef |
| \`check --form <名称> --rhymebook <id> [--variant N] [文件\|-]\` | 校验一首诗（文件或 stdin） | 文本报告（见下）；\`--json\` 出 Report。有 error 时 exit 1 |
| \`char <字…> [--rhymebook xinyun\|guyun] [--kind shi\|ci] [--json]\` | 查字的平仄、声、韵部。位置参数是一串字（如 \`白月石客\`），非汉字忽略。不给 \`--rhymebook\` 时三张韵表都查；给 \`guyun\` 而不给 \`--kind\` 时查平水韵与词林正韵 | 文本，每字一行：\`白　新韵 阳平·四开（平）　平水 入·十一陌（仄）　词林 入·第十七部（仄）\`，多音以「/」隔开，未收写「未收」；\`--json\` 出 \`[{ char, xinyun?, pingshui?, cilin? }]\`（值为 CharInfo，只含查了的表） |
| \`rhymes [韵部] --rhymebook <id> [--kind shi\|ci] [--tone 平\|仄] [--all] [--json]\` | 不给韵部：列出该韵表的全部韵。给韵部：列出该韵的常用字，\`--all\` 连僻字一起列，\`--tone\` 只看平或仄。\`--kind\` 缺省 \`shi\`。韵部名不存在时 exit 1 | 文本：列韵时每行 \`七阳　平　常用 145 / 共 273\`；列字时每条一个标题行（\`七阳 · 平 · 平水韵　常用 145 字\`）加一行字；\`--json\` 出 RhymeSummary[] / RhymeChars[]（不带 \`--all\` 时 \`rare\` 为空串） |
| \`create <game.json> [--allow-flaws] [--rm] [--no-start]\` | 校验并建局；服务没起则自动起（除非 \`--no-start\`）；\`--rm\` 建局成功后删掉输入文件 | JSON：\`{ ok: true, id, url, title, form, rhymebook, flaws: Issue[] }\`；失败 \`{ ok: false, errors: string[], report? }\` |
| \`wait <id> [--timeout 秒=540]\` | 阻塞到玩家交卷（每 500ms 查一次文件） | 交卷：Result JSON（§7）；超时：\`{ status: "pending", ... }\` 且 exit 3 |
| \`result <id>\` | 立即返回当前结果，不阻塞 | 同上（未交卷时 \`status\` 为 \`new\` / \`playing\`，exit 0） |
| \`review <id> <review.json\|->\` | 把评点写进对局 | JSON \`{ ok: true }\` |
| \`list [--json]\` | 列出已有对局 | 文本 / JSON |
| \`start [--port N] [--host H]\` | 以**脱离终端的后台进程**起服务（\`spawn\` + \`detached\` + \`unref\`，stdio 重定向到 \`server.log\`），轮询 \`/api/meta\` 确认可用后返回；已在运行则直接返回 | JSON \`{ ok, url, pid, port, already }\` |
| \`stop\` / \`status\` | 停服务 / 查状态 | JSON |
| \`serve [--port N] [--host H]\` | 前台起服务（\`start\` 内部就是 spawn 它） | 日志 |
| \`skill install [目录]\` / \`skill path\` | 把 \`skill/tuiqiao\` 复制到指定的 skills 目录（缺省 \`~/.claude/skills\`），并把 SKILL.md 里的占位符 \`__TUIQIAO_CLI__\` 换成本 CLI 的调用方式（\`node <bin 绝对路径>\`） | JSON |

端口缺省 7117，被占用则顺延找空闲端口；host 缺省 \`127.0.0.1\`。环境变量 \`TUIQIAO_PORT\`、\`TUIQIAO_HOST\`、\`TUIQIAO_PUBLIC_URL\`（覆盖对外展示的 URL 前缀，供隧道 / 远程预览用）、\`TUIQIAO_HOME\`。

\`check\` 的文本报告示例（每句一行：原文、谱面、逐字符号 ✓/✗/·）：

~~~
七绝 · 仄起首句入韵 · 中华新韵
1 折戟沉沙铁未销  中仄中平中仄平(韵)  ✓
2 自将磨洗认前朝  中平中仄仄平平(韵)  ✓
…
韵脚：销(六豪) 朝(六豪) 乔(六豪) ✓
✗ 第3句第4字「与」应平，实为仄
结论：1 处错误，0 处提醒
~~~

## 6. HTTP 服务

\`src/server/app.js\` 导出 \`createApp({ store, prosody, webDir })\`，返回 \`(req, res) => void\` 的 handler，便于测试时注入假 prosody；\`serve\` 命令用 \`node:http\` 监听。所有 API 返回 \`application/json; charset=utf-8\`，出错时 \`{ error: { code, message } }\` 加合适的状态码（400 / 404 / 409）。

静态：\`GET /\`、\`GET /g/:id\` 都返回 \`web/index.html\`；\`GET /assets/*\` 映射到 \`web/assets/*\`（防目录穿越，按扩展名给 Content-Type，\`Cache-Control: no-cache\`）。

| 方法与路径 | 请求体 | 说明 |
| --- | --- | --- |
| \`GET /api/meta\` | — | \`{ name: 'tuiqiao', version }\` |
| \`GET /api/games\` | — | \`{ games: [{ id, title, subjects, form: { name }, status, mode, grades, createdAt }] }\`，新的在前。\`grades\` 是 \`{ yuan: string\|null /* 合原：score.grade */, pin: string\|null /* 诗品：review.grade，只有 ju / fu 档有，其余恒为 null */ }\` |
| \`GET /api/games/:id\` | — | View（§6.1） |
| \`GET /api/games/:id/lookup?chars=…\` 或 \`?rhyme=…&tone=…\` | — | 查韵（§6.4） |
| \`POST /api/games/:id/mode\` | \`{ mode }\` | 选难度，\`mode\` 为六档之一。状态为 \`new\` 时任选；\`playing\` 时只许降档（fu → ju → zi → chai → bian → ze，可以跨档），降档会清空已填内容与反馈，checks 与 hints 累计保留；其它情况 409 |
| \`POST /api/games/:id/draft\` | \`{ cells }\` 或 \`{ text }\` | 只存草稿，不给反馈、不计次 |
| \`POST /api/games/:id/check\` | \`{ cells }\` 或 \`{ text }\` | zi / ju：存草稿、计一次「试」、算出每个空格的反馈。fu：存草稿、不计次、刷新 \`play.report\` |
| \`POST /api/games/:id/hint\` | \`{ type: 'pattern' }\`、\`{ type: 'char', j, i }\`、\`{ type: 'gloss', j }\`、\`{ type: 'imagery' }\` | 取提示（§6.2） |
| \`POST /api/games/:id/submit\` | \`{ cells }\` 或 \`{ text }\` | 交卷：存草稿、算终局反馈与分数、状态变 \`submitted\` |
| \`POST /api/games/:id/reveal\` | — | 揭晓原作，仅 \`submitted\` / \`revealed\` 可调，状态变 \`revealed\` |

所有 POST 成功后都返回最新的 View。\`cells\` 是 \`{ "j.i": "字" }\`，只收空格位的输入，每格取首个字符，给定字位与越界的键忽略（选字三档还要过字盘，见 §6.5）；\`text\` 仅用于「自由体 + 自赋」。

### 6.1 View

**绝不泄露未揭晓的内容**：\`reveal\` 之前，View 里不得出现被藏的字、\`note\`、未取的 \`glosses\` / \`imagery\`、原作的格律瑕疵。

~~~ts
View = {
  id, title, subjects: string[], premise: 'history'|'alternate', premiseNote: string|null,
  form: { id, name, kind: 'shi'|'ci'|'free', sketch: string },
  rhymebook: { id, name },
  story: string, createdAt: string /* ISO */,
  status: 'new'|'playing'|'submitted'|'revealed',
  modes: [{ id: 'ze'|'bian'|'chai'|'zi'|'ju'|'fu', name: '择字'|'辨字'|'拆篇'|'填字'|'补句'|'自赋',   // 由易到难，恒为六条
            group: 'xuan'|'xie',
            blanks: number /* ze / bian / zi：空格数；chai / fu：总字数；ju：所藏句数 */ }],
  play: null | {
    mode: 'ze'|'bian'|'chai'|'zi'|'ju'|'fu',
    freeText: boolean,                 // 自由体 + 自赋：没有格子，只有一个文本框
    text: string|null,                 // freeText 时的草稿
    glosses?: [{ j: number, text: string }],  // 仅 freeText：已取的句意（此时没有 board 可挂）
    patternShown: boolean,             // fu 档与选字三档恒为 true（自由体除外）；zi / ju 档取了 pattern 提示后为 true
    variantLabel: string|null,         // patternShown 时给出，如「仄起首句入韵」
    board: null | { ju: [{             // freeText 时为 null
      end: '句'|'韵'|'读'|'叠'|'叶', punct: string, stanzaEnd: boolean,
      rhyme: boolean|null,             // patternShown 为 false 时为 null
      gloss: string|null,              // 已取的句意提示
      cells: [{
        kind: 'given'|'blank'|'hinted',  // given：原作给出的字；blank：待填；hinted：用提示揭开的字（锁定）
        char: string|null,               // given / hinted 为原字；blank 为 null
        input: string|null,              // blank 位玩家当前所填
        want: '平'|'仄'|'中'|null,       // patternShown 为 false 时为 null
        fb: 'hit'|'rhyme'|'tone'|'present'|'miss'|null,  // 最近一次 check / submit 的反馈；之后改动过的格由前端自行清掉
        tried: [{ char: string, fb: 'hit'|'rhyme'|'tone'|'present'|'miss' }]  // 曾试之字（见下）；非 blank 格与 fu 档为 []
      }] }] },
    pools: null | [{                   // 字盘，仅选字三档（§6.5）；其余档为 null
      ju: number[],                    // 这一盘管哪几句（句下标，升序）；各盘合起来恰好覆盖有空格的句，ze / bian 只有一盘
      tiles: [{ char: string, tones: ('平'|'仄')[] }]   // 盘里的字，已洗过；同一个字有几枚就出现几次。已揭开的格所占的那枚不在其中
    }],
    checks: number,
    hints: { pattern: boolean, chars: number, glosses: number, imagery: string[] },
    hintsLeft: { imagery: number, glosses: number[] /* 还可取句意的句下标 */ },
    report: null | { ok, complete, issues: Issue[], stats, rhymes },   // 仅 fu 档：玩家草稿的格律报告（不含 ju）
    submittedAt: string|null,
    score: null | { hit: number, total: number, points: number, grade: string },  // zi / ju 交卷后给出；fu 为 null。grade 即「合原」
    prosody: null | { ok: boolean, complete: boolean|null, issues: Issue[] },     // 交卷后给出：玩家版本的格律（见下）；未交卷、自由体为 null
    review: null | { grade: string|null /* 「诗品」，ju / fu 档由评点人给；zi 档网页不展示 */,
                     comment: string, highlights: [{ quote: string, note: string }], at: string }
  },
  reveal: null | {                      // 仅 status 为 revealed 时
    poem: string,                       // 原作全文（带标点）
    ju: Report['ju'],                   // 原作的逐字格律
    variantLabel: string|null,
    issues: Issue[],                    // 原作自身的格律瑕疵（--allow-flaws 建的局可能非空）
    glosses: string[]|null, imagery: string[], note: string|null,
    playerPoem: string|null             // 玩家版本的全文（zi / ju：原作标点 + 玩家所填，未填处用「□」）
  }
}
~~~

fu 档的 board：诗用所选体裁的句结构，\`want\` 随玩家草稿在四个变体中自动择优（草稿为空时取原作的变体）；词固定用原作的变体；所有格都是 \`blank\`。

反馈 \`fb\`（只打在 blank 格上，按优先级取第一个成立的）：

1. \`hit\`：与原作同字（繁简视为同字，两边都经 \`simplify\` 折成简体再比）。
2. \`rhyme\`：该格是韵脚位，所填字与本组原作韵脚同韵部且声调合。本组韵部即原作 Report 里的 \`rhymes[].name\`；词依古韵而该组依平水韵通押时，\`name\` 是平水韵名，此时按所填字的平水韵读音比。
3. \`present\`：仅 ju 档——该字在原作同一句的其它位置出现（按字数配对，类似猜词游戏的「位置不对」；繁简同字）。
4. \`tone\`：平仄与原作该字相同（多音字任一读音相同即可）。
5. \`miss\`：以上皆非。空格不打反馈（null）。

选字三档只有 \`hit\` 与 \`miss\`：盘是封闭的，「同韵」「平仄合」不再带什么信息。

**曾试之字 \`tried\`**（zi / ju 档）：每次 \`check\` 算出反馈后，把每个已填的 blank 格的「字 + 反馈」记进该格的 \`tried\`。同一格再试同一个字时不重复记，只把那一条的反馈更新为最新的（\`present\` 会随句中别的格而变）；每格只留最近 12 条，先试的在前。\`submit\` 不记。该格被揭字后清掉它的记录；换档（\`mode\`）时全部清空。存于 \`play.tried\`（\`{ "j.i": [{ char, fb }] }\`），旧对局没有这个字段时视为空。

**玩家版本的格律 \`prosody\`**：交卷时对玩家版本（原作给出的字 + 玩家所填）跑一次 \`checkPoem({ partial: true })\` 存下。fu 档原样给出。zi / ju 档要守住「不泄露原作瑕疵」：凡与原作自身的 issue 相同者（\`code\`、\`ju\`、\`pos\`、\`message\` 全同）一律滤去，\`ok\` 按滤后是否还有 error 重算。\`complete\` 为是否每格都有字（旧对局没存时为 null）。给模型的 Result 里的 \`prosody\` 不滤。

### 6.2 提示

- \`pattern\`（示律）：之后 View 给出每格的 \`want\`、每句的 \`rhyme\` 与 \`variantLabel\`。zi / ju 档记 \`hints.pattern = true\`；fu 档与选字三档本来就显示，调用无副作用、不扣分。自由体无谱，返回 409。
- \`char\`（揭字）：把 \`j.i\` 位变为 \`hinted\`，\`hints.chars += 1\`。fu 档不可用；该位不是 blank 则 409。选字三档还要从盘里取走一枚（§6.5）。
- \`gloss\`（句意）：给出第 j 句的白话句意，\`hints.glosses += 1\`。对局没有 glosses 或已取过则 409。三档皆可用。
- \`imagery\`（意象）：按顺序再给一条意象，追加进 \`hints.imagery\`。取完则 409。三档皆可用。

### 6.3 记分（fu 以外各档，交卷时算）

\`total\` = 开局时的空格数（含后来被揭开的）；\`hit\` = 终局反馈为 hit 的格数（hinted 不算）。

\`points = round(100 × hit / total) − 3 × max(0, checks − 1) − 6 × hints.chars − 4 × hints.glosses − 2 × hints.imagery.length − (hints.pattern ? 5 : 0)\`，下限 0。

品第：≥95 上上，≥88 上中，≥80 上下，≥70 中上，≥60 中中，≥50 中下，≥35 下上，≥20 下中，其余下下。

### 6.4 查韵

\`GET /api/games/:id/lookup\`，韵表取该局的 \`(rhymebook, form.kind)\`（§2.3）。两种查法二选一，都给或都不给则 400。

- \`?chars=白月\`：查单字。取其中的汉字，1 到 8 个，没有汉字则 400。任何状态可用。返回 \`{ book: string /* bookName */, chars: CharInfo[] }\`。
- \`?rhyme=七阳&tone=平\`：浏览同韵常用字，\`tone\` 可省。**仅 fu 档或交卷之后可用**，否则 409——填字、补句档若能翻同韵字，韵脚空就成了选择题。返回 \`{ book, rhymes: [{ name, tone, common: string, more: number /* 未列出的僻字数 */ }] }\`，查无此韵时 \`rhymes\` 为 \`[]\`。

查韵不改对局、不计次、不扣分。

### 6.5 选字三档（字盘）

选字三档不用键盘：空格里的字只能从**字盘**（\`play.pools\`）里取，盘上每枚字只能用一次。

| 档 | 空格 | 字盘 |
| --- | --- | --- |
| \`ze\` 择字 | 同 zi 档（对局的 \`cloze\`） | 一盘，恰是全部空格的原字 |
| \`bian\` 辨字 | 同 zi 档 | 一盘，全部空格的原字 + 干扰字 |
| \`chai\` 拆篇 | 全部字位 | 只有原字，无干扰字。全篇汉字不超过 28 个时一盘，否则分盘 |

- **分盘**（chai 档，全篇汉字多于 28 个）：顺句序把句往当前盘里加；加完一句后，若这句是阕末（\`stanzaEnd\`），或这句押韵（原作 Report 该句 \`rhyme: true\`）且本盘已满 10 字，即收盘；加下一句会使本盘超过 20 字时，先收盘再加。律诗因此两句一盘。
- **干扰字**（bian 档）：目标数 \`D = min(10, max(3, ceil(空格数 / 2)))\`。
  1. 先依次取对局的 \`decoys\`，去掉与任一空格原字相同的（繁简视为同字），全部放进盘里（建局时已限 12 个）。
  2. 不足 D 个时由服务端补到 D 个：把空格按种子次序排好，轮流取其原字，用 \`charInfo(原字, rhymebook, form.kind)\` 的第一个读音查 \`rhymeChars(该读音的韵, rhymebook, form.kind, 该读音的平仄)\`，在它的常用字里按种子次序取第一个与盘中已有的字都不同（繁简视为同字）的字——与原字同韵同调，放在韵脚上也押得上。原字未收、无字可取时跳过这一格；轮完两圈仍不足 D 个也就此作罢。
- **洗牌与存储**：盘在 \`setMode\` 时生成，存为 \`play.pools = [{ ju: number[], tiles: string[] }]\`，之后不再变。一盘内的次序按 \`sha256('<id>/<mode>/<盘下标>/<洗牌前的序号>')\` 的前 4 字节升序排定（做法同自动挖空），因此可复现；补干扰字时的「种子次序」同理，键分别用 \`<id>/bian/blank/<格的键>\` 与 \`<id>/bian/pick/<格的键>/<候选字>\`。
- **View 里的盘**：从 \`play.pools\` 的每一盘里，为该盘所管的每个 hinted 格取走一枚它的原字（取盘中第一枚），余下的依原次序给出，\`tones\` 取 \`charInfo(char, rhymebook, form.kind).tones\`。
- **收草稿**（draft / check / submit）：在 §6 的通用规则之后再过一遍字盘——按句序、字序依次看每个有输入的格，所填的字须是它所属那一盘里还有余量的字（必须就是盘上那个字，不折繁简），是则扣去一枚，否则丢弃这一格的输入，不报错。
- **揭字**：该格变 hinted 后，按上一条把已填的格重新过一遍（此时盘里已少了一枚），被丢弃的格连同它的反馈一并清掉。
- **反馈**只有 \`hit\` / \`miss\`（§6.1）；\`tried\` 照记。
- **谱**：\`patternShown\` 恒为 \`form.kind !== 'free'\`，\`want\`、\`rhyme\`、\`variantLabel\` 直接给出，不记 \`hints.pattern\`。（若是先在 zi / ju 档取过 pattern 提示再降下来，\`hints.pattern\` 照旧保留。）
- **记分**同 §6.3，\`total\` 为该档开局时的空格数。没有「诗品」。

## 7. 给模型的结果与评点

\`wait\` / \`result\` 的 stdout（Result）：

~~~jsonc
{
  "status": "submitted",               // new | playing | submitted | revealed | pending（仅 wait 超时）
  "id": "k3f9qz", "title": "赤壁", "form": "七绝", "rhymebook": "xinyun",
  "mode": "zi", "modeName": "填字",    // mode 为六档之一，modeName 是它的中文名
  "original": "折戟沉沙铁未销，……",     // 原作全文
  "player": "折戟沉沙水未销，……",       // 玩家版本全文（未填处为 □；freeText 时就是玩家的文本）
  "diffs": [{ "ju": 1, "pos": 5, "original": "铁", "player": "水", "fb": "tone" }],  // fu 以外各档：与原作不同的格（序号从 1 起）
  "score": { "hit": 9, "total": 12, "points": 66, "grade": "中中" },                 // fu 为 null
  "checks": 3, "hints": { "pattern": true, "chars": 1, "glosses": 0, "imagery": [] },
  "prosody": { "ok": true, "issues": [] },   // 玩家版本的格律报告摘要（Report 的 ok 与 issues）
  "reviewed": false,
  "next": "写评点：tuiqiao review k3f9qz <review.json>"
}
~~~

\`review\` 的输入：

~~~jsonc
{
  "grade": "上中",        // 选填，九品之一，即「诗品」。fu / ju 档由评点人给：ju 档评的是玩家补的句子本身，与是否合原无关，
                          // 网页把它与按得分算出的「合原」（score.grade）并列盖印；zi 档与选字三档不填，填了网页也不展示
  "comment": "……",        // 必填，总评，纯文本，段落以空行分隔
  "highlights": [{ "quote": "水未销", "note": "……" }]   // 选填，逐处点评，至多 6 条
}
~~~

写入后对局的 \`play.review\` 即带上 \`at\` 时间戳；可重复调用以覆盖。对局未交卷时 exit 1。
