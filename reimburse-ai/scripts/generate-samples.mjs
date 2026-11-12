// Generates the sample PDF and text receipts in ./samples (PNG samples are committed as-is).
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = path.join(process.cwd(), "samples");
fs.mkdirSync(OUT, { recursive: true });

const row = (label, amount, width = 44) => label.padEnd(width - amount.length) + amount;

async function pdfReceipt(file, { title, producer, header, lines }) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  if (producer) {
    doc.setProducer(producer);
    doc.setCreator(producer);
  }
  const page = doc.addPage([420, 595]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  let y = 545;
  page.drawText(header, { x: 36, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.15) });
  y -= 30;
  for (const line of lines) {
    if (line) page.drawText(line, { x: 36, y, size: 10, font: mono, color: rgb(0.15, 0.15, 0.2) });
    y -= 15;
  }
  fs.writeFileSync(path.join(OUT, file), await doc.save());
  console.log(`samples/${file}`);
}

await pdfReceipt("02-cloudstack-invoice.pdf", {
  title: "CloudStack invoice CS-2026-1042",
  header: "CloudStack Inc.",
  lines: [
    "500 Market Street, San Francisco, CA 94105",
    "billing@cloudstack.example",
    "",
    "INVOICE",
    "Invoice No: CS-2026-1042",
    "Invoice date: November 1, 2026",
    "Bill to: Acme Robotics",
    "",
    row("Description", "Amount"),
    row("Team plan subscription - 5 seats", "249.00"),
    "",
    row("Subtotal", "249.00"),
    row("Sales tax (8%)", "19.92"),
    row("Total due (USD)", "$268.92"),
    "",
    "Paid by card ending 4242. Thank you for your business.",
  ],
});

await pdfReceipt("04-grand-harbor-hotel.pdf", {
  title: "Grand Harbor Hotel folio GH-88412",
  header: "GRAND HARBOR HOTEL",
  lines: [
    "1 Harbor Way, Boston, MA 02110",
    "",
    "GUEST FOLIO",
    "Invoice No: GH-88412",
    "Guest: Alex Kim (Acme Robotics)",
    "Arrival: Oct 25, 2026",
    "Departure: Oct 28, 2026",
    "Date: Oct 28, 2026",
    "",
    row("Room charge (3 nights x 380.00)", "1,140.00"),
    row("Subtotal", "1,140.00"),
    row("Occupancy tax", "100.00"),
    row("Total (USD)", "$1,240.00"),
    "",
    "Paid: Visa ending 4242",
  ],
});

await pdfReceipt("06-brightline-invoice-edited.pdf", {
  title: "Brightline Consulting invoice BL-0193",
  producer: "Adobe Photoshop 25.0 (Windows)",
  header: "Brightline Consulting LLC",
  lines: [
    "77 Summer Street, Boston, MA 02110",
    "",
    "INVOICE",
    "Invoice No: BL-0193",
    "Date: 2026-11-07",
    "",
    row("Strategy workshop facilitation", "480.00"),
    row("Total due (USD)", "$480.00"),
    "",
    "Payable within 14 days.",
  ],
});

fs.writeFileSync(
  path.join(OUT, "05-staples-order.txt"),
  [
    "From: Staples <orders@staples.example>",
    "Subject: Your Staples order STP-55120 has shipped",
    "",
    "Staples",
    "Order #STP-55120",
    "Order date: Nov 6, 2026",
    "",
    row("Printer paper, 10 reams", "24.99", 36),
    row("Toner cartridge (black)", "54.99", 36),
    row("Subtotal", "79.98", 36),
    row("Tax", "6.42", 36),
    row("Total", "$86.40", 36),
    "",
    "Ship to: Acme Robotics, 200 Innovation Dr, Boston MA",
    "",
  ].join("\n"),
);
console.log("samples/05-staples-order.txt");
