import { Route } from '@/types';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

export const route: Route = {
    path: '/:type/:keyword{.*}?',
    categories: ['multimedia'],
    name: 'JavBee Folo专用订阅',
    maintainers: ['yourname'],
    parameters: {
        type: '类型：new/popular/random/tag/date',
        keyword: 'popular填7/30/60；tag填标签名；date填2025-11-30'
    },
    handler,
    features: { nsfw: true },
    description: '适配Folo的JavBee订阅，恢复原截图链接拼凑逻辑'
};

// 生成RFC822时间
const generateRFC822Date = (key: string) => {
    const hash = key.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const date = new Date(2025, 0, 1 + (hash % 365));
    return date.toUTCString().replace('UTC', 'GMT');
};

// 转换文件大小为字节
const getSizeInBytes = (sizeStr: string) => {
    const match = sizeStr.match(/(\d+(\.\d+)?)\s*(GiB|MiB)/);
    if (!match) return '1073741824'; // 默认1GB
    const num = parseFloat(match[1]);
    return match[3] === 'GiB' ? Math.round(num * 1073741824).toString() : Math.round(num * 1048576).toString();
};

// 清理标题中的日文和特殊字符
const cleanTitle = (raw: string) => {
    // 提取ID（字母+数字+连字符）和大小
    const idMatch = raw.match(/[A-Z0-9-]+/);
    const sizeMatch = raw.match(/\d+(\.\d+)?\s*(GiB|MiB)/);
    const id = idMatch ? idMatch[0] : 'UnknownID';
    const size = sizeMatch ? sizeMatch[0].replace('GiB', 'GB') : '1GB';
    return `${id} ${size}`;
};

async function handler(ctx) {
    const rootUrl = 'https://javbee.vip';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    // 构建请求URL
    const currentUrl = type === 'popular' && keyword 
        ? `${rootUrl}/${type}?sort_day=${keyword}` 
        : `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;

    // 请求页面
    const response = await got({
        url: currentUrl,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36',
            'Referer': rootUrl
        },
        timeout: 10000
    });

    const $ = load(response.data);
    const items = $('.card .columns').toArray().map((el) => {
        const item = $(el);
        const titleEl = item.find('.title.is-4.is-spaced a');
        const rawTitle = titleEl.text().trim();
        const cleanItemTitle = cleanTitle(rawTitle);
        
        // 基础信息
        const itemLink = new URL(titleEl.attr('href') || currentUrl, rootUrl).href;
        const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '1 GiB';
        
        // 日期处理
        let pubDate = generateRFC822Date(cleanItemTitle);
        const dateLink = item.find('.subtitle a').attr('href');
        if (dateLink?.includes('/date/')) {
            const dateStr = dateLink.split('/date/').pop();
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                pubDate = parseDate(dateStr).toUTCString().replace('UTC', 'GMT');
            }
        }

        // 下载链接（确保有效）
        const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
        const torrent = item.find('a[title="Download .torrent"]').attr('href') || '';
        const videoId = cleanItemTitle.split(' ')[0];
        const fallbackMagnet = `magnet:?xt=urn:btih:${videoId.toLowerCase()}&dn=${encodeURIComponent(cleanItemTitle)}`;
        const downloadUrl = magnet || fallbackMagnet;

        // 封面图
        const coverImg = item.find('img.image.lazy').attr('data-src') || item.find('img.image.lazy').attr('src') || '';
        const coverImage = coverImg ? new URL(coverImg, rootUrl).href : '';

        // ========== 恢复原截图链接拼凑逻辑 ==========
        const screenshots = [];
        item.find('.images-description ul li a.img-items').each((_, el) => {
            const originalUrl = $(el).text().trim().replace(/\s+/g, '');
            if (originalUrl.startsWith('https') && originalUrl.endsWith('_s.jpg')) {
                try {
                    const urlObj = new URL(originalUrl);
                    const imgHost = urlObj.hostname;
                    const fullFileName = originalUrl.split('/').pop()?.replace(/^[A-Za-z0-9]+-/, '') || '';
                    // 原方法拼凑直接访问链接
                    const directUrl = `https://${imgHost}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${fullFileName}`;
                    screenshots.push({
                        originalUrl: originalUrl,
                        directUrl: directUrl,
                        alt: `截图${screenshots.length + 1}`
                    });
                } catch (error) {
                    screenshots.push({
                        originalUrl: originalUrl,
                        directUrl: originalUrl,
                        alt: `截图${screenshots.length + 1}`
                    });
                }
            }
        });

        // 标签
        const tags = item.find('.tags .tag').toArray().map(t => $(t).text().trim()).filter(Boolean);

        // 描述渲染
        const description = art(path.join(__dirname, 'templates/description.art'), {
            coverImage: coverImage,
            id: videoId,
            size: size.replace('GiB', 'GB'),
            pubDate: pubDate.split(' GMT')[0],
            tags: tags || [],
            magnetRaw: magnet,
            torrentLinkRaw: torrent,
            screenshots: screenshots || []
        });

        // 确保enclosure字段被正确序列化
        return {
            title: cleanItemTitle, // 极简标题
            link: itemLink,
            guid: `${itemLink}#${videoId}`,
            pubDate: pubDate, // RFC822格式
            description: description,
            author: 'JavBee',
            category: tags,
            enclosure: {
                url: downloadUrl,
                type: 'application/x-bittorrent',
                length: getSizeInBytes(size) // 必须有length
            }
        };
    });

    return {
        title: `JavBee - ${type.toUpperCase()} (Folo)`,
        link: currentUrl,
        description: 'JavBee Folo Compatible Feed',
        language: 'en',
        lastBuildDate: new Date().toUTCString().replace('UTC', 'GMT'),
        ttl: 5,
        item: items
    };
}