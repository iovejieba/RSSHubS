import { Route } from '@/types';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

// RFC822 日期格式化
const toRFC822 = (date: Date) => date.toUTCString().replace('GMT', '+0000');

// 文件大小转换（GiB/MiB → bytes）
const getSizeInBytes = (sizeStr: string) => {
    const match = sizeStr.match(/(\d+(\.\d+)?)\s*(GiB|MiB)/);
    if (!match) return 104857600; // 默认100MB
    const num = parseFloat(match[1]);
    return match[3] === 'GiB' ? Math.round(num * 1073741824) : Math.round(num * 1048576);
};

// 详情页时间提取
const getDetailPageDate = async (detailUrl: string) => {
    try {
        const response = await got({
            url: detailUrl,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129 Safari/537.36' }
        });
        const $ = load(response.data);
        const dateText = $('.subtitle a').text().trim();
        return dateText ? parseDate(dateText) : null;
    } catch (e) {
        console.error(`详情页时间获取失败: ${detailUrl}`, e);
        return null;
    }
};

// 严格遵循 RSSHub 路由规范定义
export const route: Route = {
    path: '/:type/*', // 简化参数写法（兼容旧版 RSSHub）
    categories: ['multimedia'],
    name: 'JavBee 订阅',
    maintainers: ['yourname'], // 替换为实际维护者
    features: { nsfw: true, supportBT: true },
    parameters: {
        type: 'new/popular/random/tag/date',
        keyword: 'popular 填7/30/60；tag填标签；date填2025-12-03'
    },
    description: 'JavBee Folo 专用 BT 订阅源',
    handler: async (ctx) => { // 直接内联 handler（避免引用错误）
        const rootUrl = 'https://javbee.vip';
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('*') ?? ''; // 适配简化的 path 写法

        // 构建请求 URL
        const currentUrl = type === 'popular' && keyword
            ? `${rootUrl}/${type}?sort_day=${keyword}`
            : `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;

        const response = await got({ url: currentUrl, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = load(response.data);

        // 处理列表项
        const items = await Promise.all(
            $('.card .columns').toArray().map(async (el) => {
                const item = $(el);
                const titleEl = item.find('.title.is-4.is-spaced a');
                const itemLink = new URL(titleEl.attr('href') || '/', rootUrl).href;
                const rawTitle = titleEl.text().trim();
                
                // 基础信息提取
                const idMatch = rawTitle.match(/[A-Z]{2,6}-\d{2,5}/);
                const videoId = idMatch ? idMatch[0] : 'UnknownID';
                const sizeStr = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '1 GiB';
                
                // 日期处理
                let pubDate = type === 'new' ? await getDetailPageDate(itemLink) : null;
                if (!pubDate) {
                    const dateLink = item.find('.subtitle a').attr('href');
                    if (dateLink?.includes('/date/')) {
                        const dateStr = dateLink.split('/date/').pop();
                        pubDate = dateStr ? parseDate(dateStr) : new Date();
                    }
                }

                // BT 链接提取
                const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrent = item.find('a[title="Download .torrent"]').attr('href') || '';
                
                // 封面与截图
                const cover = item.find('img.image.lazy').attr('data-src') || item.find('img.image.lazy').attr('src') || '';
                const coverImg = cover ? new URL(cover, rootUrl).href : '';
                const screenshots = [];
                item.find('.images-description ul li a.img-items').each((i, el) => {
                    const orig = $(el).text().trim().replace(/\s+/g, '');
                    if (orig.startsWith('https') && orig.endsWith('_s.jpg')) {
                        try {
                            const u = new URL(orig);
                            const full = orig.split('/').pop()?.replace(/^[A-Za-z0-9]+-/, '') || '';
                            screenshots.push({ directUrl: `https://${u.hostname}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${full}` });
                        } catch {
                            screenshots.push({ directUrl: orig });
                        }
                    }
                });

                // 描述渲染
                const description = art(path.join(__dirname, 'templates/description.art'), {
                    coverImage: coverImg, id: videoId, size: sizeStr.replace('GiB', 'GB'),
                    pubDate: pubDate ? toRFC822(pubDate).replace('+0000', '') : '',
                    magnetRaw: magnet, torrentLinkRaw: torrent, screenshots
                });

                return {
                    title: rawTitle,
                    link: itemLink,
                    guid: `${itemLink}#${videoId}`,
                    pubDate: pubDate ? toRFC822(pubDate) : undefined,
                    description,
                    enclosure_url: magnet || torrent,
                    enclosure_type: 'application/x-bittorrent',
                    enclosure_length: getSizeInBytes(sizeStr)
                };
            })
        );

        return {
            title: `JavBee - ${type}`,
            link: currentUrl,
            description: 'JavBee Folo BT 订阅源',
            language: 'en',
            lastBuildDate: toRFC822(new Date()),
            item: items
        };
    }
};