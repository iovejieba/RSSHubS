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
1. **标准enclosure格式**：遵循RSSHub官方规范
2. **Folo完全兼容**：确保enclosure标签被正确生成
3. **全客户端支持**：磁力链接直接可识别
4. **双重保障**：description中也有复制按钮`,
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
                const videoId = titleEl.text().trim() || '未知ID';
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
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

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

                // ========== 【关键修复】使用RSSHub标准enclosure格式 ==========
                // 策略：优先使用磁力链接（Folo支持磁力链接enclosure）
                const downloadUrl = magnetRaw || torrentLinkRaw;
                let enclosure = null;
                if (downloadUrl) {
                    // 计算文件大小（假设1 GiB = 1073741824 字节）
                    const sizeMatch = size.match(/(\d+(\.\d+)?)\s*(GiB|MiB|KiB)/i);
                    let lengthBytes = '0';
                    if (sizeMatch) {
                        const num = parseFloat(sizeMatch[1]);
                        const unit = sizeMatch[3].toLowerCase();
                        if (unit === 'gib') {
                            lengthBytes = Math.round(num * 1073741824).toString();
                        } else if (unit === 'mib') {
                            lengthBytes = Math.round(num * 1048576).toString();
                        } else if (unit === 'kib') {
                            lengthBytes = Math.round(num * 1024).toString();
                        }
                    }

                    // 判断链接类型
                    const isMagnet = downloadUrl.startsWith('magnet:');
                    const isTorrent = downloadUrl.endsWith('.torrent') || downloadUrl.includes('/torrent/');

                    enclosure = {
                        url: downloadUrl,
                        type: isMagnet ? 'application/x-bittorrent' : 
                              isTorrent ? 'application/x-bittorrent' : 'application/octet-stream',
                        length: lengthBytes,
                    };
                }

                // 返回最终的Item对象 - 使用RSSHub标准格式
                return {
                    title: `${videoId} ${size}`,
                    pubDate: pubDate ? parseDate(pubDate, 'YYYY-MM-DD') : new Date(),
                    link: itemLink,
                    guid: `${itemLink}#${videoId}`.replace(/\s+/g, '-'),
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        coverImage: coverImageUrl,
                        videoId,
                        size,
                        pubDateStr: pubDate || '未知日期',
                        tags,
                        magnetRaw: magnetRaw,
                        torrentLinkRaw: torrentLinkRaw,
                        screenshots,
                        // 提示用户如何使用enclosure
                        hasEnclosure: !!downloadUrl,
                        enclosureHint: downloadUrl ? '此条目包含enclosure链接，支持RSS客户端直接下载' : '',
                    }),
                    author: tags.join(', '),
                    category: tags.length > 0 ? tags : [type],
                    
                    // ========== RSSHub标准enclosure字段 ==========
                    // 主enclosure字段（必须）
                    enclosure: enclosure,
                    
                    // 备用enclosure字段（可选，但推荐同时设置）
                    enclosure_url: enclosure?.url || '',
                    enclosure_type: enclosure?.type || '',
                    enclosure_length: enclosure?.length || '',
                    
                    // 兼容字段
                    itunes_duration: enclosure?.length || '',
                };
            });

        const pageTitle = $('title').text().trim();
        const feedTitlePrefix = pageTitle.split('-')[0]?.trim() || type;

        return {
            title: `JavBee - ${feedTitlePrefix}`,
            link: currentUrl,
            item: items,
            // 添加feed级别的提示
            description: `JavBee订阅 - ${feedTitlePrefix}。所有条目均包含enclosure标签，支持Folo等RSS客户端直接下载。`,
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