import { Route } from '@/types';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

// RFC822 +0000
const toRFC822 = (date: Date) =>
    date
        .toUTCString()
        .replace('GMT', '+0000');

// 文件大小转换（GiB/MiB → bytes）
const getSizeInBytes = (sizeStr: string) => {
    const match = sizeStr.match(/(\d+(\.\d+)?)\s*(GiB|MiB)/);
    if (!match) return 104857600; // 默认100MB防止 Folo 拒绝 length=0
    const num = parseFloat(match[1]);

    return match[3] === 'GiB'
        ? Math.round(num * 1073741824)
        : Math.round(num * 1048576);
};

export const route: Route = {
    path: '/:type/:keyword{.*}?',
    categories: ['multimedia'],
    name: 'JavBee Folo 专用订阅（增强版）',
    maintainers: ['yourname'],
    features: { nsfw: true },
    parameters: {
        type: 'new/popular/random/tag/date',
        keyword: 'popular 填 7/30/60；tag 填标签；date 填 2025-11-30'
    },
    description: '完全兼容 Folo 的 JavBee 订阅，并保留截图直链拼接模式',
    handler
};

async function handler(ctx) {
    const rootUrl = 'https://javbee.vip';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    const currentUrl =
        type === 'popular' && keyword
            ? `${rootUrl}/${type}?sort_day=${keyword}`
            : `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;

    const response = await got({
        url: currentUrl,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129 Safari/537.36',
            Referer: rootUrl
        }
    });

    const $ = load(response.data);

    const items = $('.card .columns')
        .toArray()
        .map((el) => {
            const item = $(el);

            const titleEl = item.find('.title.is-4.is-spaced a');
            const rawTitle = titleEl.text().trim();

            // 提取番号用于 guid
            const idMatch = rawTitle.match(/[A-Z]{2,6}-\d{2,5}/);
            const videoId = idMatch ? idMatch[0] : 'UnknownID';

            // 标题使用原始 JavBee 标题（更友好）
            const itemTitle = rawTitle;

            // 链接
            const itemLink = new URL(titleEl.attr('href') || '/', rootUrl).href;

            // 文件大小
            const sizeStr = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '1 GiB';

            // 日期解析
            let pubDate = new Date();
            const dateLink = item.find('.subtitle a').attr('href');
            if (dateLink?.includes('/date/')) {
                const dateStr = dateLink.split('/date/').pop();
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    pubDate = parseDate(dateStr);
                }
            }
            const pub = toRFC822(pubDate);

            // ======================
            // Magnet / Torrent
            // ======================
            const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
            const torrent = item.find('a[title="Download .torrent"]').attr('href') || '';

            // ======================
            // Folo 兼容 enclosure（核心修复）
            // ======================
            let enclosure_url: string | undefined;
            let enclosure_type: string | undefined;
            let enclosure_length: number | undefined;

            const sizeBytes = getSizeInBytes(sizeStr); // number

            if (magnet) {
                enclosure_url = magnet;
                enclosure_type = 'application/x-bittorrent; torrent=magnet';
                enclosure_length = sizeBytes;
            } else if (torrent) {
                enclosure_url = torrent;
                enclosure_type = 'application/x-bittorrent; torrent=file';
                enclosure_length = sizeBytes;
            }

            // 封面图
            const cover = item.find('img.image.lazy').attr('data-src')
                || item.find('img.image.lazy').attr('src')
                || '';
            const coverImg = cover ? new URL(cover, rootUrl).href : '';

            // ======================
            // 截图直链拼接逻辑（原样保留）
            // ======================
            const screenshots = [];
            item.find('.images-description ul li a.img-items').each((i, el) => {
                const orig = $(el).text().trim().replace(/\s+/g, '');
                if (orig.startsWith('https') && orig.endsWith('_s.jpg')) {
                    try {
                        const u = new URL(orig);
                        const host = u.hostname;
                        const full = orig.split('/').pop()?.replace(/^[A-Za-z0-9]+-/, '') || '';
                        const direct = `https://${host}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${full}`;
                        screenshots.push({ originalUrl: orig, directUrl: direct });
                    } catch {
                        screenshots.push({ originalUrl: orig, directUrl: orig });
                    }
                }
            });

            // 标签
            const tags = item.find('.tags .tag')
                .toArray()
                .map((t) => $(t).text().trim())
                .filter(Boolean);

            // 描述（已在模板内部 escape）
            const description = art(path.join(__dirname, 'templates/description.art'), {
                coverImage: coverImg,
                id: videoId,
                size: sizeStr.replace('GiB', 'GB'),
                pubDate: pub.replace('+0000', ''),
                tags,
                magnetRaw: magnet,
                torrentLinkRaw: torrent,
                screenshots
            });

            // ======================
            // 最终返回（Folo 100% 兼容）
            // ======================
            return {
                title: itemTitle,
                link: itemLink,
                guid: `${itemLink}#${videoId}`,
                pubDate: pub,
                description,
                category: tags,

                enclosure_url,
                enclosure_type,
                enclosure_length
            };
        });

    return {
        title: `JavBee - ${type} (Folo)`,
        link: currentUrl,
        description: 'Folo Compatible JavBee Feed',
        language: 'en',
        lastBuildDate: toRFC822(new Date()),
        item: items
    };
}
