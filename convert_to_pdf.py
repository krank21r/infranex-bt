#!/usr/bin/env python3
"""Convert README.md to styled PDF using fpdf2."""

import re
import os
from fpdf import FPDF

def find_dejavu():
    """Find DejaVu Sans font on the system."""
    candidates = [
        r"C:\Windows\Fonts\DejaVuSans.ttf",
        r"C:\Windows\Fonts\DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.dirname(c)
    return None

def clean_unicode(text):
    """Replace Unicode chars that core fonts can't handle."""
    replacements = {
        '\u2014': '-',   # em dash
        '\u2013': '-',   # en dash
        '\u2018': "'",   # left single quote
        '\u2019': "'",   # right single quote
        '\u201c': '"',   # left double quote
        '\u201d': '"',   # right double quote
        '\u2026': '...', # ellipsis
        '\u2022': '-',   # bullet
        '\u2713': '[OK]',# checkmark
        '\u2717': '[X]', # cross
        '\u2714': '[OK]',# heavy check
        '\u2718': '[X]', # heavy cross
        '\u2611': '[ ]', # ballot box
        '\u2612': '[X]', # ballot box with x
        '\u25cf': '[*]', # black circle
        '\u25cb': '[ ]', # white circle
        '\u25a0': '[ ]', # black square
        '\u25a1': '[ ]', # white square
        '\u2192': '->',  # right arrow
        '\u2190': '<-',  # left arrow
        '\u2194': '<->', # left right arrow
        '\u21d2': '=>',  # right double arrow
        '\u00b0': ' deg',# degree
        '\u00b1': '+/-', # plus minus
        '\u00d7': 'x',   # multiplication
        '\u00f7': '/',   # division
        '\u00a0': ' ',   # non-breaking space
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    # Fallback: encode to latin-1, replace anything else
    text = text.encode('latin-1', errors='replace').decode('latin-1')
    return text


class ReadmePDF(FPDF):
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)
        self.set_margins(20, 20, 20)
        
    def header(self):
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 5, clean_unicode("Infranex BT - Bittensor Intelligence & Mining Operations Platform"), align="C")
        self.ln(8)
        
    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title):
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(30, 30, 30)
        self.ln(4)
        self.cell(0, 10, clean_unicode(title), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(0, 120, 215)
        self.set_line_width(0.8)
        self.line(20, self.get_y(), 190, self.get_y())
        self.ln(4)

    def subsection_title(self, title):
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(50, 50, 50)
        self.ln(2)
        self.cell(0, 8, clean_unicode(title), new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def sub_subsection_title(self, title):
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(70, 70, 70)
        self.ln(1)
        self.cell(0, 7, clean_unicode(title), new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body_text(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(40, 40, 40)
        self.multi_cell(0, 5.5, clean_unicode(text))
        self.ln(1)

    def bold_text(self, text):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(40, 40, 40)
        self.multi_cell(0, 5.5, clean_unicode(text))
        self.ln(1)

    def italic_text(self, text):
        self.set_font("Helvetica", "I", 10)
        self.set_text_color(80, 80, 80)
        self.multi_cell(0, 5.5, clean_unicode(text))
        self.ln(1)

    def code_block(self, code):
        self.set_font("Courier", "", 8.5)
        self.set_fill_color(240, 240, 240)
        self.set_text_color(40, 40, 40)
        lines = code.strip().split("\n")
        for line in lines:
            self.cell(0, 4.5, "  " + clean_unicode(line), fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def inline_code(self, text):
        self.set_font("Courier", "", 9)
        self.set_fill_color(230, 230, 230)
        w = self.get_string_width(text) + 4
        self.cell(w, 5.5, " " + text + " ", fill=True)
        self.set_font("Helvetica", "", 10)

    def table_header(self, headers):
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(0, 100, 180)
        self.set_text_color(255, 255, 255)
        col_width = 170 / len(headers)
        for h in headers:
            self.cell(col_width, 7, clean_unicode(h), border=1, fill=True, align="C")
        self.ln()

    def table_row(self, cells, even=False):
        self.set_font("Helvetica", "", 9)
        self.set_text_color(40, 40, 40)
        if even:
            self.set_fill_color(245, 248, 252)
        else:
            self.set_fill_color(255, 255, 255)
        col_width = 170 / len(cells)
        max_lines = 1
        for c in cells:
            lines = self.multi_cell(col_width, 5, clean_unicode(c), dry_run=True, output="LINES")
            max_lines = max(max_lines, len(lines))
        row_h = max(7, max_lines * 5)
        x_start = self.get_x()
        y_start = self.get_y()
        for i, c in enumerate(cells):
            self.set_xy(x_start + i * col_width, y_start)
            self.multi_cell(col_width, 5, clean_unicode(c), border=1, fill=True, align="L")
        self.set_xy(x_start, y_start + row_h)

    def bullet(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(40, 40, 40)
        self.cell(5, 5.5, "-")
        self.multi_cell(0, 5.5, clean_unicode(text))
        self.ln(0.5)

    def numbered_item(self, num, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(40, 40, 40)
        self.cell(8, 5.5, f"{num}.")
        self.multi_cell(0, 5.5, clean_unicode(text))
        self.ln(0.5)

    def status_badge(self, label, status):
        self.set_font("Helvetica", "B", 9)
        if status == "complete":
            self.set_fill_color(34, 139, 34)
            self.set_text_color(255, 255, 255)
            icon = "[DONE]"
        elif status == "partial":
            self.set_fill_color(255, 165, 0)
            self.set_text_color(255, 255, 255)
            icon = "[PARTIAL]"
        elif status == "missing":
            self.set_fill_color(220, 53, 69)
            self.set_text_color(255, 255, 255)
            icon = "[TODO]"
        else:
            self.set_fill_color(100, 100, 100)
            self.set_text_color(255, 255, 255)
            icon = ""
        
        w = self.get_string_width(f" {icon} {label} ") + 4
        self.cell(w, 6, f" {icon} {label} ", fill=True)
        self.set_text_color(40, 40, 40)


def parse_readme(filepath):
    """Parse README.md and return structured content."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    return content


def render_pdf(md_content, output_path):
    """Render markdown content to styled PDF."""
    pdf = ReadmePDF()
    pdf.alias_nb_pages()
    pdf.add_page()
    
    lines = md_content.split("\n")
    i = 0
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Skip empty lines
        if not stripped:
            pdf.ln(2)
            i += 1
            continue
        
        # Horizontal rule
        if stripped in ("---", "***", "___"):
            pdf.ln(2)
            pdf.set_draw_color(200, 200, 200)
            pdf.set_line_width(0.3)
            pdf.line(20, pdf.get_y(), 190, pdf.get_y())
            pdf.ln(4)
            i += 1
            continue
        
        # Headers
        if stripped.startswith("# ") and not stripped.startswith("## "):
            title = stripped[2:].strip()
            pdf.set_font("Helvetica", "B", 22)
            pdf.set_text_color(20, 60, 120)
            pdf.cell(0, 14, clean_unicode(title), new_x="LMARGIN", new_y="NEXT", align="C")
            pdf.ln(2)
            i += 1
            continue
        
        if stripped.startswith("## "):
            pdf.section_title(stripped[3:].strip())
            i += 1
            continue
        
        if stripped.startswith("### "):
            pdf.subsection_title(stripped[4:].strip())
            i += 1
            continue
        
        if stripped.startswith("#### "):
            pdf.sub_subsection_title(stripped[5:].strip())
            i += 1
            continue
        
        # Code block
        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            pdf.code_block("\n".join(code_lines))
            continue
        
        # Blockquote
        if stripped.startswith("> "):
            text = stripped[2:].strip()
            pdf.set_font("Helvetica", "I", 10)
            pdf.set_text_color(80, 80, 80)
            pdf.set_fill_color(245, 245, 250)
            pdf.set_x(25)
            pdf.multi_cell(160, 5.5, clean_unicode(text), fill=True)
            pdf.ln(2)
            i += 1
            continue
        
        # Table detection
        if "|" in stripped and stripped.startswith("|"):
            table_lines = []
            while i < len(lines) and "|" in lines[i].strip() and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            
            if len(table_lines) >= 2:
                # Parse header
                headers = [c.strip() for c in table_lines[0].split("|")[1:-1]]
                pdf.table_header(headers)
                
                # Parse rows (skip separator line)
                for idx, row_line in enumerate(table_lines[2:]):
                    cells = [c.strip() for c in row_line.split("|")[1:-1]]
                    pdf.table_row(cells, even=(idx % 2 == 0))
                pdf.ln(3)
            continue
        
        # Bullet points
        if stripped.startswith("- ") or stripped.startswith("* "):
            text = stripped[2:].strip()
            # Handle inline code and bold in bullets
            clean = re.sub(r'`([^`]+)`', r'\1', text)
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', clean)
            clean = re.sub(r'\*([^*]+)\*', r'\1', clean)
            pdf.bullet(clean_unicode(clean))
            i += 1
            continue
        
        # Numbered list
        num_match = re.match(r'^(\d+)\.\s+(.+)', stripped)
        if num_match:
            num = num_match.group(1)
            text = num_match.group(2)
            clean = re.sub(r'`([^`]+)`', r'\1', text)
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', clean)
            pdf.numbered_item(num, clean_unicode(clean))
            i += 1
            continue
        
        # Progress bar (████ style)
        if "█" in stripped or "░" in stripped:
            pdf.set_font("Courier", "", 9)
            pdf.set_text_color(40, 40, 40)
            pdf.cell(0, 5.5, clean_unicode(stripped), new_x="LMARGIN", new_y="NEXT")
            pdf.ln(1)
            i += 1
            continue
        
        # Italic only line
        if stripped.startswith("*") and stripped.endswith("*") and not stripped.startswith("**"):
            text = stripped.strip("*")
            pdf.italic_text(text)
            i += 1
            continue
        
        # Status lines with checkmarks/crosses
        if any(x in stripped for x in ["✅", "⚠️", "❌", "🔄"]):
            clean = stripped
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', clean)
            clean = re.sub(r'`([^`]+)`', r'\1', clean)
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(40, 40, 40)
            pdf.multi_cell(0, 5.5, clean_unicode(clean))
            i += 1
            continue
        
        # Regular text (strip markdown formatting)
        clean = stripped
        clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', clean)
        clean = re.sub(r'\*([^*]+)\*', r'\1', clean)
        clean = re.sub(r'`([^`]+)`', r'\1', clean)
        clean = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', clean)
        
        pdf.body_text(clean_unicode(clean))
        i += 1
    
    pdf.output(output_path)
    return output_path


if __name__ == "__main__":
    readme_path = r"D:\Infranex BT\infranex-bt\README.md"
    output_path = r"D:\Infranex BT\infranex-bt\Infranex-BT-MVP-Architecture.pdf"
    
    md_content = parse_readme(readme_path)
    render_pdf(md_content, output_path)
    print(f"PDF generated: {output_path}")
