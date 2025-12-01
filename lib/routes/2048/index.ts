import { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { load } from 'cheerio';
import timezone from '@/utils/timezone';
import { parseDate } from '@/utils/parse-date';

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
        // 1. 获取域名信息（带缓存）
        const domainInfo = (await cache.tryGet('2048:domainInfo', async () => {
            const response = await ofetch('https://2048.info');
            const $ = load(response);
            const onclickValue = $('.button').first().attr('onclick') || '';
            const matchResult = onclickValue.match(/window\.open\('([^']+)'/);
            return { url: matchResult?.[1] || rootUrl };
        })) as { url: string };

        // 2. 获取重定向URL和safeId
        const redirectResponse = await ofetch.raw(domainInfo.url);
        const redirectUrl = redirectResponse.url || rootUrl;
        const currentUrl = `${redirectUrl}thread.php?fid-${id}.html`;
        
        const redirectPage = load(redirectResponse._data || '');
        const scriptText = redirectPage('script').text() || '';
        const safeIdMatch = scriptText.match(/var safeid='(.*?)',/);
        const safeId = safeIdMatch?.[1] || '';

        // 3. 请求列表页
        const listResponse = await ofetch.raw(currentUrl, {
            headers: { cookie: `_safe=${safeId}` },
        });
        const $list = load(listResponse._data || '');

        // 清理冗余节点
        $list('#shortcut').remove();
        $list('tr[onmouseover="this.className=\'tr3 t_two\'"]').remove();

        // 4. 解析列表项
        const list = $list('#ajaxtable tbody .tr2')
            .last()
            .nextAll('.tr3')
            .toArray()
            .map((item) => {
                const $item = $list(item);
                const $subject = $item.find('a.subject');
                const href = $subject.attr('href') || '';
                const title = $subject.text().trim() || '未知标题';
                const currentHost = redirectUrl ? `https://${new URL(redirectUrl).host}` : rootUrl;
                const link = href ? `${currentHost}/${href}` : currentHost;
                const guid = href ? `${rootUrl}/2048/${href}` : `${rootUrl}/2048/${id}`;

                return { title, link, guid };
            })
            .filter((item) => !item.link.includes('undefined') && item.title);

        // 5. 解析详情页（核心：提取磁力+简化描述+配置Enclosure）
        const items = await Promise.all(
            list.map(async (item) => {
                const detailKey = `2048:detail:${item.guid}`;
                const cachedDetail = await cache.get(detailKey);
                
                if (cachedDetail) return JSON.parse(cachedDetail);

                // 请求详情页
                const detailResponse = await ofetch(item.link, {
                    headers: { cookie: `_safe=${safeId}` },
                });
                const $detail = load(detailResponse || '');

                // 清理广告和冗余节点
                $detail('.ads, .tips, script, style').remove();
                $detail('div[id^="container-"]').remove();

                // ========== 提取核心信息 ==========
                // 5.1 提取磁力链接
                const magnetText = $detail('textarea.magnet-text').text().trim() || '';
                const escapedMagnet = magnetText.replace(/&/g, '&amp;');

                // 5.2 提取影片信息
                const content = $detail('#conttpc, .tpc_content').first();
                const getInfo = (key) => {
                    const elem = content.find(`:contains("${key}")`).first();
                    return elem.text().replace(key, '').trim() || '未知';
                };
                const name = getInfo('影片名称');
                const format = getInfo('影片格式') || getInfo('文件格式');
                const size = getInfo('影片大小');
                const duration = getInfo('影片时间');
                const desc = getInfo('影片说明') || getInfo('文件说明');

                // 5.3 提取截图（简化图片标签）
                const screenshots = content.find('img[referrerpolicy="no-referrer"]')
                    .map((_, img) => {
                        const src = $detail(img).attr('src') || $detail(img).attr('ess-data') || '';
                        return src ? `<img src="${src}" referrerpolicy="no-referrer" style="max-width:100%;margin:5px 0;">` : '';
                    })
                    .get()
                    .filter(Boolean);

                // 5.4 计算Enclosure长度（字节）
                const sizeNum = size.match(/(\d+\.?\d*)/)?.[0] || '0';
                const unit = size.includes('G') ? 1024 * 1024 * 1024 : 
                             size.includes('M') ? 1024 * 1024 : 1024;
                const enclosureLength = (parseFloat(sizeNum) * unit).toString();

                // 5.5 简化Description（Folo友好）
                const simplifiedDesc = `
                    <div>
                        <strong>影片名称：</strong>${name}<br>
                        <strong>文件格式：</strong>${format}<br>
                        <strong>影片大小：</strong>${size}<br>
                        ${duration ? `<strong>影片时长：</strong>${duration}<br>` : ''}
                        <strong>影片说明：</strong>${desc}<br>
                        <strong>影片截图：</strong><br>${screenshots.join('<br>')}<br>
                        ${magnetText ? `<strong>磁力链接：</strong><br><a href="${magnetText}" style="color:#dc3545;">${magnetText}</a>` : ''}
                    </div>
                `.replace(/\n/g, '').replace(/\s+/g, ' ').trim();

                // 5.6 作者和发布时间
                const author = $detail('.fl.black').first().text().trim() || '匿名';
                const pubDateTitle = $detail('span.fl.gray').first().attr('title') || '';
                const pubDate = pubDateTitle ? timezone(parseDate(pubDateTitle), +8) : new Date();

                // 构造最终Item
                const finalItem = {
                    title: item.title,
                    link: item.link,
                    guid: item.guid,
                    author,
                    pubDate,
                    description: simplifiedDesc,
                    enclosure: magnetText ? {
                        url: escapedMagnet,
                        type: 'x-scheme-handler/magnet',
                        length: enclosureLength,
                    } : undefined,
                    enclosure_url: escapedMagnet,
                    enclosure_type: 'x-scheme-handler/magnet',
                };

                // 缓存详情页数据（1小时）
                await cache.set(detailKey, JSON.stringify(finalItem), 3600);
                return finalItem;
            })
        );

        // 6. 生成Feed标题
        const breadCrumb = $list('#main #breadCrumb a').last().text().trim() || '最新资源';
        const feedTitle = `2048核基地 - ${breadCrumb}`;

        return {
            title: feedTitle,
            link: currentUrl,
            item: items,
        };

    } catch (error) {
        console.error('2048 RSSHub Error:', error);
        ctx.status = 500;
        return {
            title: '2048核基地 - 订阅失败',
            link: rootUrl,
            description: `错误信息：${error.message}`,
            item: [],
        };
    }
}