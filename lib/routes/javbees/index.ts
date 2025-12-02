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
1. **Folo完全兼容**：匹配141jav的订阅字段规范
2. **全功能保留**：支持类型筛选、截图预览、磁力/Torrent下载
3. **标准字段输出**：确保RSS解析无异常`,
    features: {
        nsfw: true,
    },
};

async function handler(ctx) {
    const rootUrl = 'https://javbee.vip';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    // 保留原有URL构建逻辑（popular类型特殊处理sort_day参数）
    let currentUrl;
    if (type === 'popular' && keyword) {
        currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
    } else {
        currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
    }

    // 保留原有请求逻辑
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

    // 保留原有Item解析逻辑，字段对齐141jav的Folo兼容格式
    const items = $('.card .columns')
        .toArray()
        .map((itemEl) => {
            const item = $(itemEl);
            const titleEl = item.find('.title.is-4.is-spaced a');
            
            // 保留原有ID/标题逻辑
            const videoId = titleEl.text().trim() || `未知ID-${Date.now()}`;
            const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';

            // 保留原有日期解析逻辑（适配YYYY-MM-DD格式）
            let pubDate;
            const dateLink = item.find('.subtitle a').attr('href');
            if (dateLink?.includes('/date/')) {
                pubDate = dateLink.split('/date/').pop();
            }

            // 保留原有标签解析逻辑
            const tags = item.find('.tags .tag')
                .toArray()
                .map(t => $(t).text().trim())
                .filter(Boolean);

            // 保留原有下载链接提取逻辑
            const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
            const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
            const downloadUrl = magnetRaw || torrentLinkRaw;

            // 保留原有封面图/链接逻辑
            const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;
            const imageEl = item.find('img.image.lazy');
            const coverImageUrl = imageEl.attr('data-src') || imageEl.attr('src') || '';
            const coverImage = coverImageUrl ? new URL(coverImageUrl, rootUrl).href : '';

            // 保留原有截图解析逻辑（完整保留功能）
            const screenshots = [];
            item.find('.images-description ul li a.img-items').each((_, el) => {
                const originalScreenshotUrl = $(el).text().trim().replace(/\s+/g, '');
                if (originalScreenshotUrl.startsWith('https') && originalScreenshotUrl.endsWith('_s.jpg')) {
                    try {
                        const urlObj = new URL(originalScreenshotUrl);
                        const imgHostDomain = urlObj.hostname;
                        let fullFileName = originalScreenshotUrl.split('/').pop() || '';
                        fullFileName = fullFileName.replace(/^[A-Za-z0-9]+-/, '');
                        const directPreviewUrl = `https://${imgHostDomain}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${fullFileName}`;
                        screenshots.push({
                            originalUrl: originalScreenshotUrl,
                            directUrl: directPreviewUrl,
                            alt: `截图${screenshots.length + 1}`,
                        });
                    } catch (error) {
                        screenshots.push({
                            originalUrl: originalScreenshotUrl,
                            directUrl: originalScreenshotUrl,
                            alt: `截图${screenshots.length + 1}`,
                        });
                    }
                }
            });

            // 保留原有描述渲染逻辑（含封面、截图、标签等）
            const description = art(path.join(__dirname, 'templates/description.art'), {
                coverImage,
                videoId,
                size,
                pubDateStr: pubDate || '未知日期',
                tags,
                magnetRaw,
                torrentLinkRaw,
                screenshots,
            });

            // ========== 对齐141jav的Folo兼容字段 ==========
            return {
                title: `${videoId} ${size}`, // 保留标题格式
                pubDate: parseDate(pubDate, 'YYYY-MM-DD'), // 适配日期格式
                link: itemLink, // 标准link字段
                description: description, // 保留富文本描述
                author: tags.join(', ') || 'JavBee', // 作者字段（用标签填充）
                category: tags, // 分类字段
                enclosure_type: 'application/x-bittorrent', // Folo识别的附件类型
                enclosure_url: downloadUrl, // Folo识别的附件链接
            };
        });

    // 保留原有Feed元信息逻辑
    const pageTitle = $('title').text().trim();
    const feedTitle = `JavBee - ${pageTitle.split('-')[0]?.trim() || type}`;

    // 返回与141jav一致的结构（Folo可识别）
    return {
        title: feedTitle,
        link: currentUrl,
        item: items,
    };
}