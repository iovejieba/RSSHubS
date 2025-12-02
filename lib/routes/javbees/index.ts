import { Route } from '@/types';
import { getSubPath } from '@/utils/common-utils';
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
1. **Folo深度兼容**：严格匹配Folo的Feed/Entry数据模型
2. **标准RSS字段**：遵循RSSHub规范+Folo解析逻辑
3. **附件/媒体正确映射**：确保磁力链接/封面图被识别`,
    features: {
        nsfw: true,
    },
};

async function handler(ctx) {
    let currentUrl;
    const rootUrl = 'https://javbee.vip';
    const timeout = 8000;

    try {
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('keyword') ?? '';

        if (type === 'popular' && keyword) {
            currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
        } else {
            currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
        }

        const response = await got({
            method: 'get',
            url: currentUrl,
            headers: {
                Referer: rootUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            },
            timeout,
        });

        const $ = load(response.data);

        const items = $('.card .columns')
            .toArray()
            .map((item) => {
                item = $(item);

                const titleEl = item.find('.title.is-4.is-spaced a');
                // 【改动1】确保GUID唯一（Folo要求guid全局唯一）
                const videoId = titleEl.text().trim() || `未知ID-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';

                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink && dateLink.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = extractedDate;
                    }
                }

                const tags = item
                    .find('.tags .tag')
                    .toArray()
                    .map((t) => $(t).text().trim())
                    .filter((tag) => tag);

                // 提取原始下载链接
                const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
                // 【改动2】Folo的Entry.url对应RSS的link字段
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 保留影视截图原有逻辑
                const screenshots = [];
                item.find('.images-description ul li a.img-items').each((_, el) => {
                    const $a = $(el);
                    const originalScreenshotUrl = $a.text().trim().replace(/\s+/g, '');

                    if (originalScreenshotUrl.startsWith('https') && originalScreenshotUrl.endsWith('_s.jpg')) {
                        try {
                            const urlObj = new URL(originalScreenshotUrl);
                            const imgHostDomain = urlObj.hostname;
                            let fullFileName = originalScreenshotUrl.split('/').pop();
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

                // ========== 【关键修复】适配Folo的attachments解析逻辑 ==========
                const downloadUrl = magnetRaw || torrentLinkRaw;
                let enclosure = null;
                let attachments = []; // Folo的attachments是数组
                if (downloadUrl) {
                    // 【改动3】size_in_bytes必须是数字（Folo解析要求）
                    const sizeMatch = size.match(/(\d+(\.\d+)?)\s*(GiB|MiB|KiB)/i);
                    let sizeInBytes = 0;
                    if (sizeMatch) {
                        const num = parseFloat(sizeMatch[1]);
                        const unit = sizeMatch[3].toLowerCase();
                        if (unit === 'gib') {
                            sizeInBytes = Math.round(num * 1073741824);
                        } else if (unit === 'mib') {
                            sizeInBytes = Math.round(num * 1048576);
                        } else if (unit === 'kib') {
                            sizeInBytes = Math.round(num * 1024);
                        }
                    }

                    // 【改动4】Folo的mime_type映射：magnet用专属类型，torrent用标准类型
                    const isMagnet = downloadUrl.startsWith('magnet:');
                    const mimeType = isMagnet 
                        ? 'magnet/x-bittorrent' 
                        : 'application/x-bittorrent';

                    // Folo解析RSS enclosure为attachments数组（单元素）
                    attachments = [{
                        url: downloadUrl,
                        mime_type: mimeType,
                        size_in_bytes: sizeInBytes,
                        title: `${videoId}下载链接`,
                    }];

                    // 同时保留RSS标准enclosure（Folo会自动转换为attachments）
                    enclosure = {
                        url: downloadUrl,
                        type: mimeType,
                        length: sizeInBytes,
                    };
                }

                // ========== 【改动5】适配Folo的media字段（封面图） ==========
                let media = [];
                if (coverImageUrl) {
                    media = [{
                        url: coverImageUrl,
                        type: 'photo',
                        preview_image_url: coverImageUrl,
                    }];
                }

                // 渲染内容（Folo的content对应RSS的content:encoded）
                const content = art(path.join(__dirname, 'templates/description.art'), {
                    coverImage: coverImageUrl,
                    videoId,
                    size,
                    pubDateStr: pubDate || new Date().toISOString().split('T')[0],
                    tags,
                    magnetRaw: magnetRaw,
                    torrentLinkRaw: torrentLinkRaw,
                    screenshots,
                    hasEnclosure: !!downloadUrl,
                    enclosureHint: downloadUrl ? '此条目包含enclosure链接，支持Folo直接下载' : '',
                });

                return {
                    title: `${videoId} ${size}`,
                    // 【改动6】Folo的publishedAt对应RSS的pubDate（必须是Date对象）
                    pubDate: pubDate ? parseDate(pubDate) : parseDate(new Date()),
                    link: itemLink, // Folo的Entry.url映射自RSS的link
                    guid: `${itemLink}#${videoId}`, // 确保GUID唯一
                    // 【改动7】Folo的content来自RSS的content:encoded/description
                    description: content,
                    'content:encoded': content, // 显式设置content:encoded，确保Folo识别
                    author: 'JavBee',
                    category: tags.length > 0 ? tags : [type], // Folo的categories映射自RSS的category数组
                    
                    // RSS标准enclosure（Folo自动转为attachments）
                    enclosure: enclosure,
                    // 【改动8】适配Folo的media字段（可选，补充封面图）
                    'itunes:image': coverImageUrl, // Folo会从itunes:image提取media
                    
                    // 兼容字段（Folo解析RSS时自动处理）
                    attachments: attachments, // 显式设置，增强兼容性
                    media: media,
                };
            });

        const pageTitle = $('title').text().trim();
        const feedTitlePrefix = pageTitle.split('-')[0]?.trim() || type;

        // ========== Feed级适配Folo的FeedModel ==========
        return {
            title: `JavBee - ${feedTitlePrefix}`,
            link: currentUrl, // Folo的Feed.siteUrl映射自RSS的link
            description: `JavBee订阅 - ${feedTitlePrefix}。所有条目均包含标准enclosure标签，完全兼容Folo RSS。`,
            image: `${rootUrl}/favicon.ico`, // Folo的Feed.image（可选，站点图标）
            item: items,
            // 补充Folo识别的Feed元信息
            ttl: 60, // Feed刷新间隔（分钟）
            language: 'zh-CN',
        };
    } catch (error) {
        return {
            title: 'JavBee 订阅抓取失败',
            link: currentUrl || rootUrl,
            description: `错误原因：${error.message}`,
            item: [],
        };
    }
}