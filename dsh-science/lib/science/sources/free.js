/**
 * 十个无需 API key 的检索源。
 *
 * 每个源只做三件事：把 JSON/XML 变成 Record、标注能力、标注它的限额口径。
 * 发请求、限速、缓存、熔断全部交给上层。
 *
 * 实测依据（2026-10-20）：全部返回 200；未收录的源与原因见 docs/source-notes.md。
 */
import { makeRecord } from '../record.js'
import { invertAbstract, stripTags } from '../query.js'

const arr = (x) => (Array.isArray(x) ? x : (x == null ? [] : [x]))

/** xml 文本里取第一个标签内容（arxiv Atom 用）。 */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1].trim() : null
}

/** 去 CDATA / 实体 / 折叠空白。 */
function clean(xmlText) {
  if (!xmlText) return null
  return xmlText
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null
}

/** OpenAlex authorships -> 作者数组（display_name 拆分）。 */
function openAlexAuthors(authorships) {
  return arr(authorships).map((a) => {
    const name = a?.author?.display_name || ''
    const parts = name.split(/\s+/)
    return {
      family: parts.length > 1 ? parts[parts.length - 1] : name || null,
      given: parts.length > 1 ? parts.slice(0, -1).join(' ') : null,
      orcid: a?.author?.orcid || null,
      raw: name || null,
    }
  })
}

function firstPdf(locations) {
  for (const loc of arr(locations)) {
    if (loc?.pdf_url) return loc.pdf_url
  }
  return null
}

export const SOURCES = [
  {
    id: 'openalex',
    label: 'OpenAlex',
    host: 'api.openalex.org',
    needsBudget: true,
    capabilities: { search: true, abstract: true, citations: true, oaLink: true, fulltext: false },
    limitation: '无 key 时本机 IP 共享 $0.10/天；POST /api-keys 可换 $1/天',
    parse(data) {
      return arr(data?.results).map((w) => makeRecord('openalex', {
        sourceId: w.id,
        doi: w.doi,
        title: w.title || w.display_name,
        authors: openAlexAuthors(w.authorships),
        year: w.publication_year,
        venue: w.primary_location?.source?.display_name || null,
        abstract: invertAbstract(w.abstract_inverted_index),
        oaStatus: w.open_access?.oa_status || null,
        oaPdfUrl: w.best_oa_location?.pdf_url || firstPdf(w.locations),
        oaLandingUrl: w.best_oa_location?.landing_page_url || w.primary_location?.landing_page_url || null,
        citedByCount: Number.isFinite(w.cited_by_count) ? w.cited_by_count : null,
        refCount: Number.isFinite(w.referenced_works_count) ? w.referenced_works_count : null,
        lang: w.language || null,
        type: w.type || null,
        url: w.id || null,
      }))
    },
  },

  {
    id: 'crossref',
    label: 'Crossref',
    host: 'api.crossref.org',
    capabilities: { search: true, abstract: true, citations: true, oaLink: true, fulltext: false },
    limitation: '无限额，带 mailto 进 polite pool',
    parse(data) {
      return arr(data?.message?.items).map((it) => makeRecord('crossref', {
        sourceId: it.DOI,
        doi: it.DOI,
        title: arr(it.title).filter(Boolean)[0] || null,
        authors: arr(it.author).map((a) => ({ family: a.family, given: a.given, orcid: a.ORCID, raw: a.name })),
        year: arr(arr(it.issued?.['date-parts'])[0])[0],
        venue: arr(it['container-title']).filter(Boolean)[0] || null,
        volume: it.volume, issue: it.issue, page: it.page,
        abstract: stripTags(it.abstract),
        citedByCount: Number.isFinite(it['is-referenced-by-count']) ? it['is-referenced-by-count'] : null,
        oaPdfUrl: arr(it.link).find((l) => String(l['content-type']).includes('pdf'))?.URL || null,
        license: arr(it.license).map((l) => l.URL).filter(Boolean)[0] || null,
        type: it.type, lang: it.language,
        url: it.DOI ? `https://doi.org/${it.DOI}` : null,
      }))
    },
  },

  {
    id: 'europepmc',
    label: 'Europe PMC',
    host: 'www.ebi.ac.uk',
    capabilities: { search: true, abstract: true, citations: true, oaLink: true, fulltext: true },
    limitation: '无限额；resultType=core 自带 fullTextUrlList，是最稳的 OA 全文入口',
    parse(data) {
      return arr(data?.resultList?.result).map((r) => {
        const urls = arr(r.fullTextUrlList?.fullTextUrl)
        const pdf = urls.find((u) => u.documentStyle === 'pdf' && /open/i.test(u.availability || ''))
        const html = urls.find((u) => u.documentStyle === 'html' && /open/i.test(u.availability || ''))
        return makeRecord('europepmc', {
          sourceId: r.id || r.pmid || r.doi,
          doi: r.doi,
          pmid: r.pmid,
          pmcid: r.pmcid,
          title: r.title,
          authors: String(r.authorString || '').split(/,\s*/).filter(Boolean),
          year: r.pubYear,
          venue: r.journalInfo?.journal?.title || r.journalTitle || null,
          volume: r.journalInfo?.volume || r.journalVolume || null,
          issue: r.journalInfo?.issue || r.issue || null,
          pages: r.pageInfo || null,
          abstract: stripTags(r.abstractText),
          citedByCount: Number.isFinite(r.citedByCount) ? r.citedByCount : null,
          oaStatus: r.isOpenAccess === 'Y' ? 'oa' : null,
          oaPdfUrl: pdf?.url || (r.pmcid && r.isOpenAccess === 'Y' ? `https://europepmc.org/articles/${r.pmcid}?pdf=render` : null),
          oaLandingUrl: html?.url || null,
          lang: r.language || null,
          type: r.pubType || null,
          url: r.pmcid ? `https://europepmc.org/article/PMC/${r.pmcid}` : (r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : null),
        })
      })
    },
  },

  {
    id: 'pubmed',
    label: 'PubMed',
    host: 'eutils.ncbi.nlm.nih.gov',
    capabilities: { search: true, abstract: true, citations: false, oaLink: false, fulltext: false },
    limitation: '无 key 3 req/s；检索是两步（esearch → esummary）',
    /** 第一步只拿 id 列表，由 registry 的 followUp 补详情。 */
    parse(data) {
      const ids = arr(data?.esearchresult?.idlist)
      return ids.map((id) => ({ __id: String(id) }))
    },
    async followUp(ids, ctx) {
      const list = ids.slice(0, 100).join(',')
      const res = await ctx.client.json(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(list)}`,
      )
      if (!res.ok) return []
      const result = res.data?.result || {}
      return ids.map((id) => {
        const r = result[id]
        if (!r) return null
        const doi = arr(r.articleids).find((a) => a.idtype === 'doi')?.value || null
        const pmc = arr(r.articleids).find((a) => a.idtype === 'pmc')?.value || null
        return makeRecord('pubmed', {
          sourceId: id, doi, pmid: id, pmcid: pmc,
          title: r.title,
          authors: arr(r.authors).map((a) => ({ family: a.name?.split(' ').slice(-1)[0], raw: a.name })),
          year: r.pubdate,
          venue: r.fulljournalname || r.source || null,
          volume: r.volume, issue: r.issue, pages: r.pages,
          oaPdfUrl: pmc ? `https://europepmc.org/articles/${pmc}?pdf=render` : null,
          type: arr(r.pubtype).filter(Boolean)[0] || null,
          lang: r.lang?.[0] || null,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        })
      }).filter(Boolean)
    },
  },

  {
    id: 'arxiv',
    label: 'arXiv',
    host: 'export.arxiv.org',
    isXml: true,
    capabilities: { search: true, abstract: true, citations: false, oaLink: true, fulltext: true },
    limitation: '礼貌 3s/次；全文 PDF 直链可用（实测 206 + Range）',
    parse(xml) {
      const entries = String(xml).split(/<entry>/i).slice(1)
      return entries.map((raw) => {
        const block = raw.split(/<\/entry>/i)[0]
        const idUrl = tag(block, 'id') || ''
        const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').replace(/v\d+$/i, '')
        const pdfHref = (block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/i) || [])[1]
          || (block.match(/<link[^>]*href="([^"]+)"[^>]*title="pdf"/i) || [])[1]
        const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/gi)].map((m) => clean(m[1]))
        return makeRecord('arxiv', {
          sourceId: arxivId,
          arxivId,
          doi: clean(tag(block, 'arxiv:doi')),
          title: clean(tag(block, 'title')),
          authors,
          year: clean(tag(block, 'published')),
          venue: clean(tag(block, 'arxiv:journal_ref')) || 'arXiv',
          abstract: clean(tag(block, 'summary')),
          oaStatus: 'green',
          oaPdfUrl: pdfHref ? String(pdfHref).replace(/^http:/, 'https:') : (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null),
          lang: 'en',
          type: 'preprint',
          url: idUrl ? idUrl.replace(/^http:/, 'https:') : (arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
        })
      })
    },
  },

  {
    id: 'doaj',
    label: 'DOAJ',
    host: 'doaj.org',
    capabilities: { search: true, abstract: true, citations: false, oaLink: true, fulltext: false },
    limitation: '无限额；只覆盖 OA 期刊，质量过滤好',
    parse(data) {
      return arr(data?.results).map((hit) => {
        const b = hit.bibjson || {}
        const doi = arr(b.identifier).find((i) => String(i.type).toLowerCase() === 'doi')?.id || null
        const fulltext = arr(b.link).find((l) => String(l.type).toLowerCase() === 'fulltext')?.url || null
        return makeRecord('doaj', {
          sourceId: hit.id, doi,
          title: b.title,
          authors: arr(b.author).map((a) => a.name).filter(Boolean),
          year: b.year,
          venue: b.journal?.title || null,
          volume: b.journal?.volume, issue: b.journal?.number,
          pages: b.start_page ? `${b.start_page}-${b.end_page || ''}`.replace(/-$/, '') : null,
          abstract: stripTags(b.abstract),
          oaStatus: 'gold',
          oaPdfUrl: fulltext,
          oaLandingUrl: fulltext,
          lang: arr(b.language).filter(Boolean)[0] || null,
          type: 'article',
          url: fulltext || (doi ? `https://doi.org/${doi}` : null),
        })
      })
    },
  },

  {
    id: 'datacite',
    label: 'DataCite',
    host: 'api.datacite.org',
    capabilities: { search: true, abstract: true, citations: false, oaLink: false, fulltext: false },
    limitation: '无限额；偏数据集与预印本，适合查数据可用性',
    parse(data) {
      return arr(data?.data).map((item) => {
        const a = item.attributes || {}
        const abstract = arr(a.descriptions).find((d) => /abstract/i.test(d.descriptionType || ''))?.description || null
        return makeRecord('datacite', {
          sourceId: item.id, doi: a.doi,
          title: arr(a.titles).filter(Boolean)[0]?.title || null,
          authors: arr(a.creators).map((c) => ({ family: c.familyName, given: c.givenName, raw: c.name })),
          year: a.publicationYear,
          venue: a.publisher || null,
          abstract: stripTags(abstract),
          type: a.types?.resourceTypeGeneral || null,
          lang: a.language || null,
          url: a.url || (a.doi ? `https://doi.org/${a.doi}` : null),
        })
      })
    },
  },

  {
    id: 'zenodo',
    label: 'Zenodo',
    host: 'zenodo.org',
    capabilities: { search: true, abstract: true, citations: false, oaLink: true, fulltext: false },
    limitation: '无限额；预印本/软件/数据集，常能拿到作者自存版',
    parse(data) {
      return arr(data?.hits?.hits).map((h) => {
        const m = h.metadata || {}
        return makeRecord('zenodo', {
          sourceId: String(h.id), doi: m.doi,
          title: m.title,
          authors: arr(m.creators).map((c) => ({ family: (c.name || '').split(',').slice(-1)[0]?.trim(), raw: c.name })),
          year: m.publication_date,
          venue: m.journal?.title || m.imprint?.publisher || 'Zenodo',
          abstract: stripTags(m.description),
          oaStatus: 'green',
          oaPdfUrl: arr(h.files).find((f) => /pdf/i.test(f.key || f.type || ''))?.links?.self || null,
          type: m.resource_type?.type || null,
          url: h.links?.self_html || (m.doi ? `https://doi.org/${m.doi}` : null),
        })
      })
    },
  },

  {
    id: 'openaire',
    label: 'OpenAIRE',
    host: 'api.openaire.eu',
    capabilities: { search: true, abstract: true, citations: false, oaLink: true, fulltext: false },
    limitation: '无限额；聚合欧洲项目产出，补 Crossref 覆盖不到的软性成果',
    parse(data) {
      const results = arr(data?.response?.results?.result)
      const txt = (node) => {
        if (node == null) return null
        if (typeof node === 'string') return node
        if (typeof node === 'number') return String(node)
        if (node.$ != null) return String(node.$)
        if (node.content != null) return txt(node.content)
        return null
      }
      return results.map((r) => {
        const res = r?.metadata?.['oaf:entity']?.['oaf:result'] || {}
        const pids = arr(res.pid)
        const doiPid = pids.find((p) => /doi/i.test(p?.['@attributes']?.classid || ''))
        const inst = arr(res.children?.instance)
        const bestUrl = inst.map((i) => i?.webresource?.url?.$).find(Boolean) || null
        const pdfUrl = inst.map((i) => arr(i?.webresource).map((w) => w?.url?.$)?.find((u) => /\.pdf$/i.test(u || ''))).find(Boolean) || null
        return makeRecord('openaire', {
          sourceId: doiPid ? txt(doiPid) : txt(res.title),
          doi: doiPid ? txt(doiPid) : null,
          title: txt(res.title),
          authors: arr(res.creator).map((c) => txt(c)).filter(Boolean),
          year: txt(res.dateofacceptance),
          venue: txt(res.publisher) || null,
          abstract: stripTags(txt(res.description)),
          oaStatus: /OPEN/i.test(res.bestaccessright?.['@attributes']?.classname || '') ? 'green' : null,
          oaPdfUrl: pdfUrl,
          oaLandingUrl: bestUrl,
          type: txt(res.resulttype?.['@attributes']?.classname) || null,
          url: bestUrl,
        })
      })
    },
  },
]

/** 按 id 取源定义。 */
export function getSource(id) {
  return SOURCES.find((s) => s.id === id) || null
}

/** 默认参与 fanout 的源（去掉预算受限与两步检索的差异由 registry 处理）。 */
export function defaultSourceIds() {
  return SOURCES.map((s) => s.id)
}

export default { SOURCES, getSource, defaultSourceIds }
