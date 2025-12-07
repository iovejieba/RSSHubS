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
    name: 'JavBee 通用订阅（全客户端兼容）',
    maintainers: ['cgkings', 'nczitzk'],
    parameters: { 
        type: '类型，可选值：new(最新)、popular(热门)、random(随机)、tag(指定标签)、date(指定日期)', 
        keyword: '关键词：popular填7/30/60；tag填标签名；date填年月日(2025-11-30)；new/random留空' 
    },
    handler,
    description: `### 订阅示例
- 最新资源：\`/javbee/new\`
- 30天热门：\`/javbee/popular/30\`
- 指定标签：\`/javbee/tag/Adult%20Awards\`（标签空格替换为%20）
- 指定日期：\`/javbee/date/2025-11-30\`
- 随机资源：\`/javbee/random\`

### 功能说明
1. 自动抓取封面图、文件大小、发布日期、标签；
2. 支持Torrent下载链接和磁力链接提取；
3. 自动剥离文件名随机前缀，拼接100%有效图床直链；
4. 全客户端兼容：Folo可识别磁力链接，其他RSS客户端正常渲染。`,
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

        // 构造请求URL
        if (type === 'popular' && keyword) {
            currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
        } else {
            currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
        }

        // 请求列表页
        const response = await got({
            method: 'get',
            url: currentUrl,
            headers: {
                'Referer': rootUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            timeout,
        });

        const $ = load(response.data);

        // 遍历所有资源条目
        const items = $('.card .columns')
            .toArray()
            .map((item) => {
                item = $(item);

                // 1. 提取基础信息
                const titleEl = item.find('.title.is-4.is-spaced a');
                const videoId = titleEl.text().trim() || '未知ID';
                const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
                
                // 2. 提取发布日期
                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink && dateLink.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = extractedDate;
                    }
                }

                // 3. 提取标签
                const tags = item
                    .find('.tags .tag')
                    .toArray()
                    .map((t) => $(t).text().trim())
                    .filter(tag => tag);

                // 4. 提取下载链接（关键：双版本转义处理）
                const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 4.1 简化磁力链接格式（只保留基本的btih参数）
                let simplifiedMagnet = '';
                if (magnetRaw) {
                    const match = magnetRaw.match(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}/);
                    simplifiedMagnet = match ? match[0] : magnetRaw;
                }

                // 4.2 XML规范转义（用于Enclosure，兼容Folo/XML解析器）
                const escapedMagnet = simplifiedMagnet 
                    ? simplifiedMagnet.replace(/&/g, '&amp;') 
                    : '';
                const escapedTorrent = torrentLinkRaw 
                    ? torrentLinkRaw.replace(/&/g, '&amp;') 
                    : '';

                // 4.3 HTML展示转义（用于Description，用户可直接点击）
                const displayMagnet = simplifiedMagnet.replace(/&/g, '&amp;');
                const displayTorrent = torrentLinkRaw.replace(/&/g, '&amp;');

                // 5. 提取封面图
                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 6. 截图处理（Folo友好型简化）
                const screenshots = [];
                item.find('.images-description ul li a.img-items').each((_, el) => {
                    const $a = $(el);
                    const originalScreenshotUrl = $a.text().trim().replace(/\s+/g, '');
                    
                    if (originalScreenshotUrl.startsWith('https') && originalScreenshotUrl.endsWith('_s.jpg')) {
                        try {
                            const urlObj = new URL(originalScreenshotUrl);
                            const imgHostDomain = urlObj.hostname;
                            let fullFileName = originalScreenshotUrl.split('/').pop();
                            fullFileName = fullFileName.replace(/^[A-Za-z0-9]+-/, ''); // 剥离随机前缀
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
                                alt: `截图${screenshots.length + 1}`
                            });
                        }
                    }
                });

                // 7. 构造Enclosure（Folo兼容：单Enclosure+正确Type）
                let enclosure = null;
                if (escapedMagnet) {
                    enclosure = {
                        url: escapedMagnet,
                        type: 'application/x-bittorrent', // 兼容Folo的磁力链接类型
                        length: size.replace(/\D/g, '') || '0', // Folo必填length
                    };
                } else if (escapedTorrent) {
                    enclosure = {
                        url: escapedTorrent,
                        type: 'application/x-bittorrent',
                        length: size.replace(/\D/g, '') || '0',
                    };
                }

                // 8. 返回Item（全客户端兼容配置）
                return {
                    title: `${videoId} ${size}`,
                    pubDate: parseDate(pubDate, 'YYYY-MM-DD'), // RFC822格式，兼容所有客户端
                    link: itemLink,
                    guid: `${itemLink}-${videoId}`.replace(/\//g, '-'), // 唯一GUID，避免Folo去重错误
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        coverImage: coverImageUrl,
                        id: videoId,
                        size,
                        pubDate: pubDate || '未知日期',
                        tags,
                        magnet: displayMagnet, // HTML友好的链接
                        torrentLink: displayTorrent,
                        screenshots,
                    }),
                    category: tags.length > 0 ? tags : [type],
                    enclosure: enclosure, // 单Enclosure，Folo优先识别
                    // 兼容旧客户端的冗余配置（可选）
                    enclosure_type: enclosure?.type || '',
                    enclosure_url: enclosure?.url || '',
                };
            });

        // 生成Feed标题
        const pageTitle = $('title').text().trim();
        const feedTitlePrefix = pageTitle.split('-')[0]?.trim() || type;
        const feedTitle = `JavBee - ${feedTitlePrefix} 资源订阅`;

        return {
            title: feedTitle,
            link: currentUrl,
            item: items,
        };

    } catch (error) {
        ctx.status = 500;
        return {
            title: 'JavBee 订阅抓取失败',
            link: currentUrl || rootUrl,
            description: `错误原因：${error.message}（若频繁失败，可能是站点反爬限制）`,
            item: [],
        };
    }
}