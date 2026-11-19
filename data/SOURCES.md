# 格律数据来源与构建

| 上游 | 许可 | 构建读取的文件 |
| --- | --- | --- |
| [chinese_word_rhyme](https://github.com/charlesix59/chinese_word_rhyme) | MIT，见 [随附版权与许可](LICENSE-chinese_word_rhyme) | `chinese_word_rhyme/Pingshui_Rhyme.json`、`chinese_word_rhyme/Cilin_Rhyme.json`、`chinese_word_rhyme/Ci_Tunes.json` |
| [pinyin-data](https://github.com/mozillazg/pinyin-data) | [MIT](https://github.com/mozillazg/pinyin-data/blob/master/LICENSE) | `pinyin-data/kXHC1983.txt`、`pinyin-data/kTGHZ2013.txt`、`pinyin-data/kMandarin.txt` |
| [OpenCC](https://github.com/ByVoid/OpenCC) | Apache-2.0，见 [随附许可](LICENSE-APACHE-2.0) | [`opencc/TSCharacters.txt`](https://github.com/ByVoid/OpenCC/blob/master/data/dictionary/TSCharacters.txt) |

把上表列出的原始文件放到仓库根目录的 `.cache/sources/` 下，并保留表中的子目录。用 Node.js ≥ 18 在仓库根目录执行以下命令，生成可直接使用的单行 UTF-8 JSON。构建只读本地文件，同一组原始输入会得到逐字节相同的结果。

```sh
node scripts/build-data.mjs
```

| 文件 | 结构 |
| --- | --- |
| `xinyun.json` | `{names, byChar}`。每个字指向一组 `[声调下标, 韵部下标, 带调拼音]`。阴平、阳平、上声、去声依次编号 0–3。 |
| `pingshui.json` | `{groups, byChar}`。字表值是 `groups` 中 `[声, 韵部]` 的下标数组。 |
| `cilin.json` | 与平水韵使用相同结构。韵部为词林正韵的十九部。平水韵补入的半韵保留两个可能归部。原表只标仄且平水韵无法细分时，上、去皆为可能读法。 |
| `tunes.json` | 词牌名映射到 `[简介, 格式列表]`，每个格式为 `[sketch, author, 模式串]`。数字 `0/1/2` 表示中、平、仄，`,`、`=`、`:`、`*`、`~`、`%` 依次标记句、韵、读、叠、叶、显式换韵，`!` 标记阕末。列表首项为正体。 |
| `simplified.json` | 繁体单字映射到 OpenCC 字表的首选简体单字。 |

新韵以现代审音数据按韵母归部，当优先来源没有可用读音时依次取次级数据。「一、不、七、八」采用本调。词谱简介保留至多 120 字。原始词谱有 818 个名称，其中「清平调辞」的格式列表为空，产物保留其余 817 个名称的全部 2,475 个格式。

平水韵合并 [人工补字表](../scripts/pingshui-supplement.txt)。新增的上声「三讲」追加在原韵部表之后。词林正韵沿用原表的归部，缺字从合并后的平水韵表推导。
