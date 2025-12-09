import { Route } from '@/types';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    path: '/:type/*',
    categories: ['multimedia'],
    example: '/javbees/new',
    parameters: {
        type: '内容类型，可选值：new(最新), popular(热门), random(随机), tag(标签), date(日期)',
        keyword: '根据type不同含义不同：popular时填7/30/60(天)，tag时填标签名称，date时填日期(如2025-12-03)'
    },
    features: { 
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: true,
        supportPodcast: false,
        supportScihub: false,
        nsfw: true 
    },
    description: 'JavBee 专用 BT 订阅源',
    maintainers: ['contributor'],
    handler: async (ctx) => {
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
                let pubDate = null;
                
                // 首先尝试从详情页获取日期
                if (type === 'new') {
                    pubDate = await getDetailPageDate(itemLink);
                }
                
                // 如果详情页没有日期，尝试从列表项的日期链接获取
                if (!pubDate) {
                    const dateLink = item.find('.subtitle a').attr('href');
                    if (dateLink?.includes('/date/')) {
                        const dateStr = dateLink.split('/date/').pop();
                        if (dateStr) {
                            pubDate = parseDate(dateStr);
                        }
                    }
                }
                
                // 如果仍然没有日期，使用当前日期作为默认值
                if (!pubDate) {
                    pubDate = new Date();
                }

                // BT 链接提取
                let magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
                let torrent = item.find('a[title="Download .torrent"]').attr('href') || '';
                
                // 确保 magnet 链接格式正确
                if (magnet && !magnet.startsWith('magnet:')) {
                    magnet = '';
                }
                
                // 确保 torrent 链接格式正确
                if (torrent && !torrent.startsWith('http')) {
                    torrent = '';
                }
                
                // 磁力链接简化处理：只保留基本的xt参数，确保与标准文件一致
                const magnetMatch = magnet.match(/magnet:\?xt=urn:btih:[a-f0-9]{40}/i);
                const displayMagnet = magnetMatch ? magnetMatch[0] : magnet;
                
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
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const description = art(path.join(__dirname, 'templates/description.art'), {
                    coverImage: coverImg, id: videoId, size: sizeStr.replace('GiB', 'GB'),
                    pubDate: pubDate ? toRFC822(pubDate).replace('+0000', '') : '',
                    magnet: displayMagnet, torrentLink: torrent, screenshots
                });

                // 确保enclosure_url不为空
                const enclosureUrl = magnet ? magnet : torrent;

                return {
                    title: rawTitle,
                    link: itemLink,
                    guid: `${itemLink}#${videoId}`,
                    pubDate: pubDate ? toRFC822(pubDate) : undefined,
                    author: 'javbees',
                    category: ['视频', 'BT'],
                    description,
                    content: {
                        html: description,
                        text: `${rawTitle} ${videoId} - ${sizeStr}`
                    },
                    enclosure_url: enclosureUrl,
                    enclosure_type: 'application/x-bittorrent',
                    enclosure_length: getSizeInBytes(sizeStr)
                };
            })
        );

        // 创建自定义的响应对象，利用toJSON方法在中间件处理完成后再次移除referrerpolicy属性
        const response = {
            title: `JavBee - ${type}`,
            link: currentUrl,
            description: 'JavBee BT 订阅源',
            language: 'zh-CN',
            lastBuildDate: toRFC822(new Date()),
            item: items,
            
            // 自定义toJSON方法，在中间件处理完成后自动调用
            toJSON() {
                // 处理所有item的description
                const processedItems = this.item.map(item => {
                    if (item.description) {
                        const $desc = load(item.description);
                        $desc('img').removeAttr('referrerpolicy');
                        return {
                            ...item,
                            description: $desc.html() || '',
                            content: {
                                ...item.content,
                                html: $desc.html() || ''
                            }
                        };
                    }
                    return item;
                });
                
                return {
                    ...this,
                    item: processedItems
                };
            }
        };

        return response;
    }
};