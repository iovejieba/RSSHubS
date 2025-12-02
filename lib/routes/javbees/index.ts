import { Route } from '@/types';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

export const route: Route = {
    path: '/:type/:keyword{.*}?',
    categories: ['multimedia'],
    name: 'JavBee 通用订阅 (Folo兼容版)',
    maintainers: ['cgkings', 'nczitzk'],
    parameters: {
        type: '类型，可选值：new(最新)、popular(热门)、random(随机)、tag(指定标签)、date(指定日期)',
        keyword: '关键词：popular填7/30/60；tag填标签名；date填年月日(2025-11-30)；new/random留空',
    },
    handler,
    description: `### 订阅示例
- 最新资源：\`/javbee/new\`
- 30天热门：\`/javbee/popular/30\`
- 指定标签：\`/javbee/tag/Adult%20Awards\`（标签空格替换为%20）
- 指定日期：\`/javbee/date/2025-11-30\`
- 随机资源：\`/javbee/random\`

### 功能说明
1. **Folo完全兼容**：补充enclosure字段，修复pubDate格式
2. **全功能保留**：截图预览、磁力/Torrent下载、标签解析
3. **严格匹配141PPV结构**：确保所有核心字段存在`,
    features: {
        nsfw: true,
    },
};

// 生成RFC 822格式时间（解决pubDate缺失）
const generateRFC822Date = (uniqueKey: string) => {
    let hash = 0;
    for (let i = 0; i < uniqueKey.length; i++) {
        hash = uniqueKey.charCodeAt(i) + ((hash << 5) - hash);
    }
    const baseDate = new Date('2025-01-01T00:00:00Z');
    const offset = Math.abs(hash) % (365 * 24 * 60 * 60 * 1000); // 一年内随机偏移
    const finalDate = new Date(baseDate.getTime() + offset);
    return finalDate.toUTCString().replace(/UTC/, 'GMT'); // 确保RFC 822格式
};

async function handler(ctx) {
    const rootUrl = 'https://javbee.vip';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    // 构建请求URL
    let currentUrl;
    if (type === 'popular' && keyword) {
        currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
    } else {
        currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
    }

    // 请求页面
    const response = await got({
        method: 'get',
        url: currentUrl,
        headers: {
            Referer: rootUrl,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        timeout: 8000,
    });

    const $ = load(response.data);

    // 解析Item（确保包含enclosure字段）
    const items = $('.card .columns')
        .toArray()
        .map((itemEl) => {
            const item = $(itemEl);
            const titleEl = item.find('.title.is-4.is-spaced a');
            
            // 基础信息提取
            const rawVideoId = titleEl.text().trim() || `未知ID-${Date.now()}`;
            const videoId = rawVideoId.replace(/\[FHD\]|\[FHDC\]|\s+/g, '').split(' ')[0] || rawVideoId;
            const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
            const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

            // 发布日期（优先解析，无则生成）
            let pubDate;
            const dateLink = item.find('.subtitle a').attr('href');
            if (dateLink?.includes('/date/')) {
                const extractedDate = dateLink.split('/date/').pop();
                if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                    const parsedDate = parseDate(extractedDate, 'YYYY-MM-DD');
                    pubDate = parsedDate.toUTCString().replace(/UTC/, 'GMT');
                }
            }
            if (!pubDate) {
                pubDate = generateRFC822Date(`${videoId}-${itemLink}`);
            }

            // 下载链接（磁力/Torrent）
            const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
            const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
            const downloadUrl = magnetRaw || torrentLinkRaw;

            // 封面图
            const imageEl = item.find('img.image.lazy');
            const coverImageUrl = imageEl.attr('data-src') || imageEl.attr('src') || '';
            const coverImage = coverImageUrl ? new URL(coverImageUrl, rootUrl).href : '';

            // 标签解析
            const tags = item.find('.tags .tag')
                .toArray()
                .map(t => $(t).text().trim())
                .filter(Boolean);

            // 截图解析
            const screenshots = [];
            item.find('.images-description ul li a.img-items').each((_, el) => {
                const originalUrl = $(el).text().trim().replace(/\s+/g, '');
                if (originalUrl.startsWith('https') && originalUrl.endsWith('_s.jpg')) {
                    try {
                        const urlObj = new URL(originalUrl);
                        const imgHost = urlObj.hostname;
                        const fullFileName = originalUrl.split('/').pop()?.replace(/^[A-Za-z0-9]+-/, '') || '';
                        const directUrl = `https://${imgHost}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${fullFileName}`;
                        screenshots.push({ originalUrl, directUrl, alt: `截图${screenshots.length + 1}` });
                    } catch {
                        screenshots.push({ originalUrl, directUrl: originalUrl, alt: `截图${screenshots.length + 1}` });
                    }
                }
            });

            // 渲染描述
            const description = art(path.join(__dirname, 'templates/description.art'), {
                coverImage,
                videoId: rawVideoId,
                size,
                pubDateStr: pubDate.split(' GMT')[0],
                tags,
                magnetRaw,
                torrentLinkRaw,
                screenshots,
            });

            // ========== 关键：确保enclosure字段存在（匹配141PPV格式） ==========
            const enclosure = {
                url: downloadUrl,
                type: 'application/x-bittorrent', // 固定类型，Folo识别
            };

            return {
                title: `${videoId} ${size}`, // 简洁Title
                link: itemLink,
                guid: `${itemLink}#${videoId}`, // 唯一标识
                pubDate: pubDate, // RFC 822格式
                description: description,
                author: 'JavBee',
                category: tags,
                enclosure: enclosure, // 必须包含的字段
            };
        });

    // Feed元信息
    const pageTitle = $('title').text().trim();
    const feedTitle = `JavBee - ${pageTitle.split('-')[0]?.trim() || type}`;

    return {
        title: feedTitle,
        link: currentUrl,
        description: `JavBee ${type}资源订阅（Folo专用）`,
        language: 'en',
        lastBuildDate: new Date().toUTCString().replace(/UTC/, 'GMT'),
        ttl: 5,
        item: items,
    };
}