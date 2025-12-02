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
1. **合法RSS标准**：确保XML解析无错误
2. **Folo深度兼容**：通过标准字段自动映射Folo模型
3. **无非法标签**：避免XML解析异常`,
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

        // 构建请求URL
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
            timeout,
        });

        const $ = load(response.data);

        // 解析Item
        const items = $('.card .columns')
            .toArray()
            .map((itemEl) => {
                const $item = $(itemEl);
                const titleEl = $item.find('.title.is-4.is-spaced a');
                
                // 基础信息
                const videoId = titleEl.text().trim() || `未知ID-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const size = $item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 发布日期解析
                let pubDate;
                const dateLink = $item.find('.subtitle a').attr('href');
                if (dateLink?.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = parseDate(extractedDate);
                    }
                }

                // 标签解析
                const tags = $item.find('.tags .tag')
                    .toArray()
                    .map(t => $(t).text().trim())
                    .filter(Boolean);

                // 封面图
                const imageEl = $item.find('img.image.lazy');
                const coverImageUrl = imageEl.attr('data-src') || imageEl.attr('src');
                const coverImage = coverImageUrl ? new URL(coverImageUrl, rootUrl).href : '';

                // 下载链接
                const magnetRaw = $item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLinkRaw = $item.find('a[title="Download .torrent"]').attr('href') || '';
                const downloadUrl = magnetRaw || torrentLinkRaw;

                // 截图解析（保留原有逻辑）
                const screenshots = [];
                $item.find('.images-description ul li a.img-items').each((_, el) => {
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

                // 计算文件大小（字节数，用于enclosure.length）
                let sizeInBytes = 0;
                const sizeMatch = size.match(/(\d+(\.\d+)?)\s*(GiB|MiB|KiB)/i);
                if (sizeMatch) {
                    const num = parseFloat(sizeMatch[1]);
                    switch (sizeMatch[3].toLowerCase()) {
                        case 'gib': sizeInBytes = Math.round(num * 1073741824); break;
                        case 'mib': sizeInBytes = Math.round(num * 1048576); break;
                        case 'kib': sizeInBytes = Math.round(num * 1024); break;
                    }
                }

                // RSS标准Enclosure（Folo会自动转为attachments）
                let enclosure = null;
                if (downloadUrl) {
                    const isMagnet = downloadUrl.startsWith('magnet:');
                    enclosure = {
                        url: downloadUrl,
                        type: isMagnet ? 'magnet/x-bittorrent' : 'application/x-bittorrent',
                        length: sizeInBytes, // 必须是数字
                    };
                }

                // 渲染描述内容
                const description = art(path.join(__dirname, 'templates/description.art'), {
                    coverImage,
                    videoId,
                    size,
                    pubDateStr: pubDate ? pubDate.toISOString().split('T')[0] : '未知日期',
                    tags,
                    magnetRaw,
                    torrentLinkRaw,
                    screenshots,
                });

                // ========== 仅保留RSS标准字段 ==========
                return {
                    title: `${videoId} ${size}`,
                    link: itemLink,
                    guid: `${itemLink}#${videoId}`, // 全局唯一标识
                    pubDate: pubDate || new Date(), // 确保是Date对象
                    description: description,
                    'content:encoded': description, // RSS标准富文本字段
                    author: 'JavBee',
                    category: tags.length ? tags : [type],
                    enclosure: enclosure, // 标准附件字段
                    'itunes:image': coverImage, // Folo识别封面图的标准字段
                };
            });

        // Feed元信息
        const pageTitle = $('title').text().trim();
        const feedTitle = `JavBee - ${pageTitle.split('-')[0]?.trim() || type}`;

        // 返回合法RSS结构
        return {
            title: feedTitle,
            link: currentUrl,
            description: `JavBee ${type}资源订阅（兼容Folo）`,
            language: 'zh-CN',
            ttl: 60,
            item: items,
        };

    } catch (error) {
        // 错误处理
        return {
            title: 'JavBee 订阅抓取失败',
            link: currentUrl || rootUrl,
            description: `错误信息：${error.message}`,
            item: [],
        };
    }
}