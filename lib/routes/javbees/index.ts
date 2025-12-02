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
        type: '类型：new(最新)/popular(热门)/random(随机)/tag(标签)/date(日期)',
        keyword: '关键词：popular填7/30/60；tag填标签名；date填2025-11-30；new/random留空',
    },
    handler,
    description: `### 订阅示例
- 最新资源：\`/javbee/new\`
- 30天热门：\`/javbee/popular/30\`
- 指定标签：\`/javbee/tag/Adult%20Awards\`
- 指定日期：\`/javbee/date/2025-11-30\`
- 随机资源：\`/javbee/random\``,
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

// 转换文件大小为字节数（适配enclosure的length属性）
const getSizeInBytes = (sizeStr: string) => {
    if (!sizeStr) return '0';
    const sizeMatch = sizeStr.match(/(\d+(\.\d+)?)\s*(GiB|MiB|KiB)/i);
    if (!sizeMatch) return '0';
    const num = parseFloat(sizeMatch[1]);
    switch (sizeMatch[3].toLowerCase()) {
        case 'gib': return Math.round(num * 1073741824).toString();
        case 'mib': return Math.round(num * 1048576).toString();
        case 'kib': return Math.round(num * 1024).toString();
        default: return '0';
    }
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

    // 请求页面数据
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

    // 解析Item列表（修复所有未定义变量问题）
    const items = $('.card .columns')
        .toArray()
        .map((itemEl) => {
            const item = $(itemEl);
            const titleEl = item.find('.title.is-4.is-spaced a');
            
            // 基础信息提取
            const rawVideoId = titleEl.text().trim() || `未知ID-${Date.now()}`;
            const videoId = rawVideoId.replace(/\[FHD\]|\[FHDC\]|\s+/g, '').split(' ')[0] || rawVideoId;
            const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '1 MiB';
            const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

            // 解析发布日期（优先页面数据，无则生成）
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

            // 解析标签（确保返回数组，避免undefined）
            const tags = item.find('.tags .tag')
                .toArray()
                .map(t => $(t).text().trim())
                .filter(Boolean);

            // 解析封面图
            const imageEl = item.find('img.image.lazy');
            const coverImageUrl = imageEl.attr('data-src') || imageEl.attr('src') || '';
            const coverImage = coverImageUrl ? new URL(coverImageUrl, rootUrl).href : '';

            // 解析下载链接（磁力/Torrent）
            const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
            const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
            const downloadUrl = magnetRaw || torrentLinkRaw || `magnet:?xt=urn:btih:${videoId.toLowerCase()}`; // 兜底

            // 解析截图（完整保留功能，避免模板报错）
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

            // 渲染描述内容（传递所有模板所需变量）
            const description = art(path.join(__dirname, 'templates/description.art'), {
                coverImage: coverImage || '',
                videoId: rawVideoId || '',
                size: size || '',
                pubDateStr: pubDate.split(' GMT')[0] || '未知日期',
                tags: tags || [], // 强制传递数组，避免undefined
                magnetRaw: magnetRaw || '',
                torrentLinkRaw: torrentLinkRaw || '',
                screenshots: screenshots || [], // 强制传递数组，避免模板报错
            });

            // Folo兼容的Enclosure字段（包含所有RSS标准属性）
            const enclosure = {
                url: downloadUrl,
                type: 'application/x-bittorrent',
                length: getSizeInBytes(size), // 必须包含length属性
            };

            // 返回Item完整数据（匹配141PPV结构）
            return {
                title: `${videoId} ${size}`, // 简洁标题，避免特殊字符
                link: itemLink,
                guid: `${itemLink}#${videoId}`, // 唯一标识，避免重复
                pubDate: pubDate, // RFC 822格式，必填
                description: description,
                author: 'JavBee',
                category: tags, // 分类字段
                enclosure: enclosure, // 必须包含，Folo识别资源
            };
        });

    // Feed元信息
    const pageTitle = $('title').text().trim();
    const feedTitle = `JavBee - ${pageTitle.split('-')[0]?.trim() || type.toUpperCase()}`;

    // 返回标准RSS结构（Folo可识别）
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