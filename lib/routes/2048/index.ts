import { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { load } from 'cheerio';
import timezone from '@/utils/timezone';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

export const route: Route = {
    path: '/:id?',
    categories: ['multimedia'],
    example: '/2048/2',
    parameters: { id: '板块 ID, 见下表，默认为最新合集，即 `3`，亦可在 URL 中找到, 例如, `thread.php?fid-3.html`中, 板块 ID 为`3`' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: true,
        supportPodcast: false,
        supportScihub: false,
        nsfw: true,
    },
    name: '论坛',
    maintainers: ['nczitzk'],
    handler,
    description: `| 最新合集 | 亞洲無碼 | 日本騎兵 | 歐美新片 | 國內原創 | 中字原創 | 三級寫真 |
| -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| 3        | 4        | 5        | 13       | 15       | 16       | 18       |

| 有碼.HD | 亞洲 SM.HD | 日韓 VR/3D | 歐美 VR/3D | S-cute / Mywife / G-area |
| ------- | ---------- | ---------- | ---------- | ------------------------ |
| 116     | 114        | 96         | 97         | 119                      |

| 網友自拍 | 亞洲激情 | 歐美激情 | 露出偷窺 | 高跟絲襪 | 卡通漫畫 | 原創达人 |
| -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| 23       | 24       | 25       | 26       | 27       | 28       | 135      |

| 唯美清純 | 网络正妹 | 亞洲正妹 | 素人正妹 | COSPLAY | 女优情报 | Gif 动图 |
| -------- | -------- | -------- | -------- | ------- | -------- | -------- |
| 21       | 274      | 276      | 277      | 278     | 29       |          |

| 獨家拍攝 | 稀有首發 | 网络见闻 | 主播實錄 | 珍稀套圖 | 名站同步 | 实用漫画 |
| -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| 213      | 94       | 283      | 111      | 88       | 131      | 180      |

| 网盘二区 | 网盘三区 | 分享福利 | 国产精选 | 高清福利 | 高清首发 | 多挂原创 |
| -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| 72       | 272      | 195      | 280      | 79       | 216      | 76       |

| 磁链迅雷 | 正片大片 | H-GAME | 有声小说 | 在线视频 | 在线快播影院 |
| -------- | -------- | ------ | -------- | -------- | ------------ |
| 43       | 67       | 66     | 55       | 78       | 279          |

| 综合小说 | 人妻意淫 | 乱伦迷情 | 长篇连载 | 文学作者 | TXT 小说打包 |
| -------- | -------- | -------- | -------- | -------- | ------------ |
| 48       | 103      | 50       | 54       | 100      | 109          |

| 聚友客栈 | 坛友自售 |
| -------- | -------- |
| 57       | 136      |`,
};

async function handler(ctx) {
    const id = ctx.req.param('id') ?? '3';
    const rootUrl = 'https://hjd2048.com';

    try {
        // ========== 1. 空值保护：获取域名信息 ==========
        const domainInfo = (await cache.tryGet('2048:domainInfo', async () => {
            const response = await ofetch('https://2048.info');
            const $ = load(response);
            const onclickValue = $('.button').first().attr('onclick') || '';
            const matchResult = onclickValue.match(/window\.open\('([^']+)'/);
            const targetUrl = matchResult?.[1] || rootUrl; // 匹配失败时用默认值
            
            return { url: targetUrl };
        })) as { url: string };

        // ========== 2. 空值保护：获取重定向URL和safeId ==========
        const redirectResponse = await ofetch.raw(domainInfo.url);
        const redirectUrl = redirectResponse.url || rootUrl;
        const currentUrl = `${redirectUrl}thread.php?fid-${id}.html`;
        
        const redirectPageContent = load(redirectResponse._data || '');
        const scriptText = redirectPageContent('script').text() || '';
        const safeIdMatch = scriptText.match(/var safeid='(.*?)',/);
        const safeId = safeIdMatch?.[1] || ''; // safeId为空时设为字符串

        // ========== 3. 空值保护：请求列表页 ==========
        const response = await ofetch.raw(currentUrl, {
            headers: {
                cookie: `_safe=${safeId}`,
            },
        });
        const $ = load(response._data || '');

        $('#shortcut').remove();
        $('tr[onmouseover="this.className=\'tr3 t_two\'"]').remove();

        // ========== 4. 空值保护：处理列表项 ==========
        const list = $('#ajaxtable tbody .tr2')
            .last()
            .nextAll('.tr3')
            .toArray()
            .map((item) => {
                const $item = $(item);
                const $subject = $item.find('a.subject');
                const href = $subject.attr('href') || ''; // href为空时设为字符串
                const title = $subject.text() || '未知标题';
                
                // 拼接链接时避免null/undefined
                const currentHost = redirectUrl ? `https://${new URL(redirectUrl).host}` : rootUrl;
                const link = href ? `${currentHost}/${href}` : currentHost;
                const guid = href ? `${rootUrl}/2048/${href}` : `${rootUrl}/2048/${id}`;

                return {
                    title,
                    link,
                    guid,
                };
            })
            .filter((item) => !item.link.includes('undefined')); // 过滤无效链接

        // ========== 5. 空值保护：处理详情页 ==========
        const items = await Promise.all(
            list.map((item) =>
                cache.tryGet(item.guid, async () => {
                    const detailResponse = await ofetch(item.link, {
                        headers: {
                            cookie: `_safe=${safeId}`,
                        },
                    });
                    const content = load(detailResponse || '');

                    content('.ads, .tips').remove();

                    // 处理图片时的空值保护
                    content('ignore_js_op').each(function () {
                        const $this = content(this);
                        const $img = $this.find('img');
                        const originalSrc = $img.attr('data-original') || $img.attr('src') || '';
                        if (originalSrc) {
                            $this.replaceWith(`<img src="${originalSrc}">`);
                        } else {
                            $this.remove(); // 无图片时移除节点
                        }
                    });

                    // 提取信息时的空值保护
                    item.author = content('.fl.black').first().text() || '未知作者';
                    const pubDateTitle = content('span.fl.gray').first().attr('title') || '';
                    item.pubDate = pubDateTitle ? timezone(parseDate(pubDateTitle), +8) : new Date();

                    // 处理下载链接时的空值保护
                    const downloadLink = content('#read_tpc').first().find('a').last();
                    const copyLink = content('#copytext')?.first()?.text() || '';

                    if (downloadLink?.text()?.startsWith('http')) {
                        try {
                            const torrentUrl = downloadLink.text();
                            if (/bt\.azvmw\.com$/.test(new URL(torrentUrl).hostname)) {
                                const torrentResponse = await ofetch(torrentUrl);
                                const torrent = load(torrentResponse || '');

                                item.enclosure_type = 'application/x-bittorrent';
                                const ahref = torrent('.uk-button').last().attr('href') || '';
                                item.enclosure_url = ahref.startsWith('http') ? ahref : `https://bt.azvmw.com/${ahref}`;

                                const magnet = torrent('.uk-button').first().attr('href') || '';
                                downloadLink.replaceWith(
                                    art(path.join(__dirname, 'templates/download.art'), {
                                        magnet,
                                        torrent: item.enclosure_url,
                                    })
                                );
                            }
                        } catch (e) {
                            // 异常时跳过，避免中断流程
                            console.error('处理Torrent链接失败:', e);
                        }
                    } else if (copyLink.startsWith('magnet')) {
                        item.enclosure_url = copyLink.replace(/&/g, '&amp;'); // 转义时检查copyLink非空
                        item.enclosure_type = 'x-scheme-handler/magnet';
                    }

                    // 处理隐藏图片时的空值保护
                    const desp = content('#read_tpc').first();
                    content('.showhide img').each(function () {
                        const src = content(this).attr('src') || '';
                        if (src) {
                            desp.append(`<br><img style="max-width: 100%;" src="${src}">`);
                        }
                    });

                    item.description = desp.html() || '无内容';
                    return item;
                })
            )
        );

        // ========== 6. 空值保护：生成Feed标题 ==========
        const breadCrumbText = $('#main #breadCrumb a').last().text() || '2048核基地';
        return {
            title: `${breadCrumbText} - 2048核基地`,
            link: currentUrl,
            item: items,
        };
    } catch (error) {
        console.error('2048 RSSHub报错:', error);
        ctx.status = 500;
        return {
            title: '2048核基地 - 订阅失败',
            link: rootUrl,
            description: `错误信息：${error.message}`,
            item: [],
        };
    }
}