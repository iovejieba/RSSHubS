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
        type: '类型：new/popular/random/tag/date',
        keyword: '关键词：popular填7/30/60；tag填标签名；date填2025-11-30',
    },
    handler,
    features: { nsfw: true },
};

// 生成文件大小（适配enclosure的length属性）
const getSizeInBytes = (sizeStr: string) => {
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

// 生成RFC 822时间
const generateRFC822Date = (uniqueKey: string) => {
    let hash = 0;
    for (let i = 0; i < uniqueKey.length; i++) {
        hash = uniqueKey.charCodeAt(i) + ((hash << 5) - hash);
    }
    const baseDate = new Date('2025-01-01T00:00:00Z');
    const offset = Math.abs(hash) % (365 * 24 * 60 * 60 * 1000);
    return new Date(baseDate.getTime() + offset).toUTCString().replace(/UTC/, 'GMT');
};

async function handler(ctx) {
    const rootUrl = 'https://javbee.vip';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    const currentUrl = type === 'popular' && keyword 
        ? `${rootUrl}/${type}?sort_day=${keyword}` 
        : `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;

    const response = await got({
        url: currentUrl,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36' },
        timeout: 8000,
    });

    const $ = load(response.data);
    const items = $('.card .columns').toArray().map((itemEl) => {
        const item = $(itemEl);
        const titleEl = item.find('.title.is-4.is-spaced a');
        const rawId = titleEl.text().trim().split(' ')[0] || `ID-${Date.now()}`;
        const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '1 MiB';
        const itemLink = new URL(titleEl.attr('href') || currentUrl, rootUrl).href;
        
        // 日期处理
        let pubDate = generateRFC822Date(rawId);
        const dateLink = item.find('.subtitle a').attr('href');
        if (dateLink?.includes('/date/')) {
            const dateStr = dateLink.split('/date/').pop();
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                pubDate = parseDate(dateStr, 'YYYY-MM-DD').toUTCString().replace(/UTC/, 'GMT');
            }
        }

        // 下载链接（确保有值）
        const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
        const torrent = item.find('a[title="Download .torrent"]').attr('href') || magnet;
        const downloadUrl = torrent || `magnet:?xt=urn:btih:${rawId.toLowerCase()}`; // 兜底

        // ========== 关键：强制enclosure字段包含所有属性（确保RSSHub渲染为标签） ==========
        const enclosure = {
            url: downloadUrl,
            type: 'application/x-bittorrent',
            length: getSizeInBytes(size), // 必须添加length属性（RSS标准要求）
        };

        // 描述渲染
        const cover = item.find('img.image.lazy').attr('data-src') || item.find('img.image.lazy').attr('src') || '';
        const description = art(path.join(__dirname, 'templates/description.art'), {
            coverImage: cover ? new URL(cover, rootUrl).href : '',
            videoId: rawId,
            size,
            pubDateStr: pubDate.split(' GMT')[0],
            magnetRaw: magnet,
            torrentLinkRaw: torrent,
        });

        // ========== 严格匹配141PPV的字段顺序+结构 ==========
        return {
            title: `${rawId} ${size}`, // 简洁标题
            description: description,
            link: itemLink,
            guid: `${itemLink}#${rawId}`,
            pubDate: pubDate,
            enclosure: enclosure, // 必须包含url/type/length
            author: 'JavBee',
        };
    });

    return {
        title: `JavBee - ${type.toUpperCase()}`,
        link: currentUrl,
        description: `JavBee ${type}资源订阅`,
        language: 'en',
        lastBuildDate: new Date().toUTCString().replace(/UTC/, 'GMT'),
        ttl: 5,
        item: items,
    };
}