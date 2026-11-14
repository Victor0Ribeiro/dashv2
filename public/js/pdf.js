// Exportação de relatórios em PDF (jsPDF + AutoTable, servidos localmente e carregados sob demanda).
import { loadScript } from './ui.js';

const JSPDF_SRC = '/vendor/jspdf/jspdf.umd.min.js';
const AUTOTABLE_SRC = '/vendor/jspdf-autotable/jspdf.plugin.autotable.min.js';

const ACCENT = [124, 58, 237];
const TEXT = [28, 23, 38];
const MUTED = [95, 88, 115];

// As fontes padrão do PDF só cobrem Latin-1: troca caracteres fora dessa faixa (ex.: travessão).
const pdfText = value =>
    String(value ?? '')
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...')
        .replace(/[^\x00-\xFF]/g, '');

async function loadJsPdf() {
    await loadScript(JSPDF_SRC);
    await loadScript(AUTOTABLE_SRC);
    const { jsPDF } = window.jspdf;
    if (typeof jsPDF.API.autoTable !== 'function' && typeof window.applyPlugin === 'function') {
        window.applyPlugin(jsPDF);
    }
    return jsPDF;
}

/** Renderiza um gráfico Chart.js fora da tela, com fundo branco, e devolve a imagem PNG. */
function renderChartImage(config, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const whiteBackground = {
        id: 'whiteBackground',
        beforeDraw(chart) {
            const { ctx } = chart;
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
        },
    };
    const chart = new window.Chart(canvas, {
        ...config,
        options: { ...config.options, responsive: false, animation: false, devicePixelRatio: 2 },
        plugins: [...(config.plugins ?? []), whiteBackground],
    });
    // JPEG (fundo já é branco): o PNG em alta resolução deixava o PDF com vários MB.
    const image = canvas.toDataURL('image/jpeg', 0.9);
    chart.destroy();
    return image;
}

/**
 * Gera e baixa um relatório: cabeçalho, gráfico e tabela.
 * @param {object} report
 * @param {string} report.title
 * @param {string[]} report.details   linhas de contexto (filtro, modo...)
 * @param {object} report.chart       configuração Chart.js já com cores de impressão
 * @param {{head: string[], body: string[][]}} report.table
 * @param {string} report.filename
 * @param {string} [report.note]      observação abaixo da tabela
 */
export async function exportReport({ title, details = [], chart, table, filename, note }) {
    const jsPDF = await loadJsPdf();
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;

    // Faixa de título
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, pageWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text('RADAR DE TALENTOS', margin, 36);
    doc.setFontSize(18);
    doc.setTextColor(...TEXT);
    doc.text(pdfText(title), margin, 60);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    const generatedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    const lines = [`Gerado em ${generatedAt}`, ...details].map(pdfText);
    doc.text(lines, margin, 80);
    let y = 80 + lines.length * 13 + 10;

    // Gráfico
    const imageWidth = contentWidth;
    const imageHeight = Math.round(imageWidth * 0.72);
    const image = renderChartImage(chart, 900, Math.round(900 * 0.72));
    doc.addImage(image, 'JPEG', margin, y, imageWidth, imageHeight);
    y += imageHeight + 16;

    // Tabela
    doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [table.head.map(pdfText)],
        body: table.body.map(row => row.map(pdfText)),
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: TEXT, lineColor: [226, 221, 236] },
        headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold', halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
        bodyStyles: { halign: 'center' },
        alternateRowStyles: { fillColor: [248, 246, 252] },
    });

    if (note) {
        const noteY = doc.lastAutoTable.finalY + 16;
        doc.setFontSize(9);
        doc.setTextColor(...MUTED);
        doc.text(doc.splitTextToSize(pdfText(note), contentWidth), margin, noteY);
    }

    // Rodapé com numeração
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page);
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Página ${page} de ${pages}`, pageWidth - margin, pageHeight - 20, { align: 'right' });
    }

    doc.save(filename);
}

/** Nome de arquivo seguro com a data de hoje. */
export function reportFilename(prefix) {
    const today = new Date().toISOString().slice(0, 10);
    const slug = prefix
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    return `${slug}-${today}.pdf`;
}
