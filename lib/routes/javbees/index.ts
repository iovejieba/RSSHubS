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
    name: 'JavBee 通用订阅 (Folo最终兼容版)',
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
1. **基于已验证能生成enclosure的代码进行修复**，确保标签存在。
2. **修正三大致命错误**：无效日期、错误MIME类型、URL过度转义。
3. **完全遵循141PPV成功范例**的enclosure格式。
4. **全客户端兼容**：确保Folo可识别，其他客户端支持一键复制。`,
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

                // 提取原始下载链接（关键：保持原始，不在此处转义）
                const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // ========== 【关键修复1/3】删除对enclosure链接的过度转义 ==========
                // 原代码中的以下两行被移除，因为它们会导致URL中的`=`被错误转义为`&#61;`
                // const escapedMagnet = magnetRaw.replace(/&/g, '&amp;').replace(/=/g, '&#61;').replace(/\+/g, '&#43;');
                // const escapedTorrent = torrentLinkRaw.replace(/&/g, '&amp;');
                // ====================================================================

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

                // 构造Enclosure对象
                let enclosure = null;
                // 策略：优先使用磁力链接，其次种子文件
                const downloadUrl = magnetRaw || torrentLinkRaw;
                if (downloadUrl) {
                    enclosure = {
                        // *** 关键：直接使用原始链接，RSSHub在生成XML时会进行正确的属性值转义 ***
                        url: downloadUrl,
                        // ========== 【关键修复2/3】使用标准MIME类型 ==========
                        type: 'application/x-bittorrent', // 原为 'x-scheme-handler/magnet'
                        // ===================================================
                        length: size.replace(/\D/g, '') || '0',
                    };
                }

                // 返回最终的Item对象
                return {
                    title: `${videoId} ${size}`, // 调整为更完整的标题
                    // ========== 【关键修复3/3】确保pubDate永远有效 ==========
                    pubDate: pubDate ? parseDate(pubDate, 'YYYY-MM-DD') : new Date(),
                    // =====================================================
                    link: itemLink,
                    guid: `${itemLink}#${videoId}`.replace(/\s+/g, '-'),
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        coverImage: coverImageUrl,
                        videoId,
                        size,
                        pubDateStr: pubDate || '未知日期', // 模板中使用的日期字符串
                        tags,
                        // 传递给模板的也是原始链接
                        magnetRaw: magnetRaw,
                        torrentLinkRaw: torrentLinkRaw,
                        screenshots,
                    }),
                    author: tags.join(', '),
                    category: tags.length > 0 ? tags : [type],
                    // *** 关键：仅返回标准的enclosure对象，RSSHub会将其转为<enclosure>标签 ***
                    enclosure: enclosure,
                    // ========== 重要：删除原代码中可能导致干扰的冗余字段 ==========
                    // enclosure_type: enclosure?.type || '',
                    // enclosure_url: enclosure?.url || '',
                };
            });

        const pageTitle = $('title').text().trim();
        const feedTitlePrefix = pageTitle.split('-')[0]?.trim() || type;

        return {
            title: `JavBee - ${feedTitlePrefix}`,
            link: currentUrl,
            item: items,
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