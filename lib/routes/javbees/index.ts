import path from 'node:path';

import { load } from 'cheerio';

import type { Route } from '@/types';
import { getSubPath } from '@/utils/common-utils';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
<<<<<<< HEAD
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit'; // 用于限制并发请求数

// 并发请求限制（避免图床拦截，可根据需求调整）
const concurrencyLimit = pLimit(3);

// 配置开关：是否使用旧的URL拼凑规则（false=使用新的图床爬取逻辑，true=回退到旧逻辑）
const USE_OLD_PATCH_RULE = false;
=======
>>>>>>> 4e78a14d818670a67123398298d844d8766e2597

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
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129 Safari/537.36' },
            timeout: 10000 // 10秒超时
        });
        const $ = load(response.data);
        const dateText = $('.subtitle a').text().trim();
        return dateText ? parseDate(dateText) : null;
    } catch (e) {
        console.error(`详情页时间获取失败: ${detailUrl}`, e);
        return null;
    }
};

/**
 * 旧逻辑：URL拼凑规则（用于回退）
 * @param thumbnailUrl 原始缩略图链接
 * @returns 拼凑后的原图链接
 */
const oldPatchScreenshotUrl = (thumbnailUrl: string) => {
    try {
        const u = new URL(thumbnailUrl);
        const full = u.pathname.split('/').pop()?.replace(/^[A-Za-z0-9]+-/, '') || '';
        return `https://${u.hostname}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${full}`;
    } catch (error) {
        console.error(`旧逻辑拼凑URL失败: ${thumbnailUrl}`, error);
        return thumbnailUrl;
    }
};

/**
 * 新逻辑：访问图床页面提取原图直连地址（核心升级）
 * @param thumbnailPageUrl 缩略图页面链接
 * @returns 原图绝对直连地址（失败返回原始链接/旧逻辑结果降级）
 */
const fetchOriginalScreenshotUrl = async (thumbnailPageUrl: string) => {
    // 跳过无效链接
    if (!thumbnailPageUrl.startsWith('https')) {
        console.debug(`跳过无效图床链接: ${thumbnailPageUrl}`);
        return thumbnailPageUrl;
    }

    // 开关：使用旧逻辑回退
    if (USE_OLD_PATCH_RULE) {
        return oldPatchScreenshotUrl(thumbnailPageUrl);
    }

    try {
        // 访问图床页面（模拟浏览器请求，避免被拦截）
        const response = await got({
            url: thumbnailPageUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129 Safari/537.36',
                'Referer': 'https://javbee.vip/', // 携带来源页，提高通过率
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 15000, // 15秒超时（图床可能较慢）
            retry: 1 // 失败重试1次
        });

        const $ = load(response.data);
        let originalUrl = '';

        // 核心：提取图床页面中的主图src（适配实际DOM结构）
        const mainImg = $('body img').first(); // 取页面第一个img标签（图床页面通常只有一张主图）
        if (mainImg.length) {
            originalUrl = mainImg.attr('src') || '';
            // 验证是否为有效图片地址
            if (originalUrl && (originalUrl.endsWith('.jpg') || originalUrl.endsWith('.png') || originalUrl.endsWith('.webp'))) {
                // 转换为绝对URL（避免相对路径）
                const absoluteOriginalUrl = new URL(originalUrl, thumbnailPageUrl).href;
                console.debug(`成功提取原图: ${thumbnailPageUrl} → ${absoluteOriginalUrl}`);
                return absoluteOriginalUrl;
            }
        }

        // 未找到原图，降级使用旧逻辑拼凑
        console.warn(`未在图床页面找到有效原图，降级使用旧逻辑: ${thumbnailPageUrl}`);
        return oldPatchScreenshotUrl(thumbnailPageUrl);

    } catch (error) {
        console.error(`图床访问失败，降级使用旧逻辑: ${thumbnailPageUrl}`, error);
        // 失败时先尝试旧逻辑，再不行返回原始链接
        return oldPatchScreenshotUrl(thumbnailPageUrl);
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
    description: 'JavBee 专用 BT 订阅源（自动爬取图床原图+旧逻辑兼容）',
    maintainers: ['contributor'],
    handler: async (ctx) => {
        const rootUrl = 'https://javbee.vip';
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('*') ?? ''; // 适配简化的 path 写法

        // 构建请求 URL
        const currentUrl = type === 'popular' && keyword
            ? `${rootUrl}/${type}?sort_day=${keyword}`
            : `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;

        // 请求主页面
        const response = await got({ 
            url: currentUrl, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129 Safari/537.36' },
            timeout: 10000
        });
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
                if (type === 'new') {
                    pubDate = await getDetailPageDate(itemLink);
                }
                if (!pubDate) {
                    const dateLink = item.find('.subtitle a').attr('href');
                    if (dateLink?.includes('/date/')) {
                        const dateStr = dateLink.split('/date/').pop();
                        pubDate = dateStr ? parseDate(dateStr) : new Date();
                    } else {
                        pubDate = new Date();
                    }
                }

                // BT 链接提取
                let magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
                let torrent = item.find('a[title="Download .torrent"]').attr('href') || '';
                if (magnet && !magnet.startsWith('magnet:')) magnet = '';
                if (torrent && !torrent.startsWith('http')) torrent = '';
                const magnetMatch = magnet.match(/magnet:\?xt=urn:btih:[a-f0-9]{40}/i);
                const displayMagnet = magnetMatch ? magnetMatch[0] : magnet;
                
                // 封面处理
                const cover = item.find('img.image.lazy').attr('data-src') || item.find('img.image.lazy').attr('src') || '';
                const coverImg = cover ? new URL(cover, rootUrl).href : '';
                
                // 截图处理：收集链接 + 并发限制请求图床
                const screenshots = [];
                const screenshotPageUrls = [];
                // 第一步：收集所有截图页面链接
                item.find('.images-description ul li a.img-items').each((i, el) => {
                    const orig = $(el).text().trim().replace(/\s+/g, '');
                    if (orig.startsWith('https')) {
                        screenshotPageUrls.push(orig);
                    }
                });
                // 第二步：带并发限制请求图床获取原图地址
                const originalUrls = await Promise.all(
                    screenshotPageUrls.map(url => concurrencyLimit(() => fetchOriginalScreenshotUrl(url)))
                );
                // 第三步：整理截图数据
                originalUrls.forEach(url => {
                    screenshots.push({ directUrl: url });
                });

                // 描述渲染（art模板）
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const description = art(path.join(__dirname, 'templates/description.art'), {
                    coverImage: coverImg, 
                    id: videoId, 
                    size: sizeStr.replace('GiB', 'GB'),
                    pubDate: pubDate ? toRFC822(pubDate).replace('+0000', '') : '',
                    magnet: displayMagnet, 
                    torrentLink: torrent, 
                    screenshots
                });

                // 确保enclosure_url不为空
                const enclosureUrl = magnet ? magnet : torrent;

                // 构造RSS item
                return {
                    title: rawTitle,
                    link: itemLink,
                    guid: `${itemLink}#${videoId}`, // 唯一标识
                    pubDate: pubDate ? toRFC822(pubDate) : undefined,
                    author: 'javbees',
                    category: ['视频', 'BT'],
                    description,
                    content: {
                        html: description,
                        text: `${rawTitle} ${videoId} - ${sizeStr}` // 纯文本内容，适配RSS阅读器
                    },
                    enclosure_url: enclosureUrl,
                    enclosure_type: 'application/x-bittorrent',
                    enclosure_length: getSizeInBytes(sizeStr)
                };
            })
        );

        // 构造最终RSS响应（清理img标签的referrerpolicy属性）
        const responseObj = {
            title: `JavBee - ${type}`,
            link: currentUrl,
            description: 'JavBee BT 订阅源（自动适配新旧图床）',
            language: 'zh-CN',
            lastBuildDate: toRFC822(new Date()),
            item: items,
            
            // 自定义toJSON方法，处理HTML中的多余属性
            toJSON() {
                const processedItems = this.item.map(item => {
                    if (item.description) {
                        const $desc = load(item.description);
                        $desc('img').removeAttr('referrerpolicy'); // 移除多余属性，避免RSS解析问题
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

        return responseObj;
    }
};
