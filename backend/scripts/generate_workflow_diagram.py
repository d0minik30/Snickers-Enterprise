import os
os.environ["MPLCONFIGDIR"] = os.environ.get("TEMP", "/tmp")

import matplotlib.pyplot as plt
import matplotlib.patches as patches

# Set high-DPI figure with clean off-white background matching the user reference image
fig = plt.figure(figsize=(12, 14), dpi=300, facecolor="#F8F9FA")
ax = fig.add_subplot(111)
ax.set_facecolor("#F8F9FA")
ax.set_xlim(0, 100)
ax.set_ylim(0, 100)
ax.axis("off")

def draw_card(ax, center_x, center_y, width, height, title, subtitle, bg_color, border_color, title_color="#1E293B", sub_color="#475569"):
    # Calculate lower-left corner
    x0 = center_x - width / 2.0
    y0 = center_y - height / 2.0
    
    # Rounded rectangle box
    box = patches.FancyBboxPatch(
        (x0, y0), width, height,
        boxstyle="round,pad=0.8,rounding_size=1.6",
        facecolor=bg_color,
        edgecolor=border_color,
        linewidth=2.0,
        zorder=3
    )
    ax.add_patch(box)
    
    # Title text
    ax.text(
        center_x, center_y + height * 0.16,
        title,
        ha="center", va="center",
        fontsize=14, fontweight="bold",
        color=title_color,
        fontfamily="sans-serif",
        zorder=4
    )
    
    # Subtitle text
    ax.text(
        center_x, center_y - height * 0.20,
        subtitle,
        ha="center", va="center",
        fontsize=10.5, fontweight="normal",
        color=sub_color,
        fontfamily="sans-serif",
        linespacing=1.35,
        zorder=4
    )
    return (center_x, y0, center_x, y0 + height) # bottom_center, top_center

def draw_arrow(ax, start_pt, end_pt):
    ax.annotate(
        "",
        xy=end_pt, xycoords="data",
        xytext=start_pt, textcoords="data",
        arrowprops=dict(
            arrowstyle="->,head_width=0.45,head_length=0.6",
            color="#475569",
            lw=2.0,
            shrinkA=2,
            shrinkB=2,
        ),
        zorder=2
    )

# Coordinates for top-down layout
# Y levels: 90 (Input), 72 (Sources), 50 (Engine), 30 (Refine), 10 (Outputs)

# 1. TOP: User Input
top_card = draw_card(
    ax, center_x=50, center_y=90, width=44, height=10.5,
    title="User Uploads Surface Photo",
    subtitle="Captured by astronaut / rover with camera FOV & tilt\nUploaded via /locate web interface",
    bg_color="#FFFFFF", border_color="#CBD5E1",
    title_color="#0F172A", sub_color="#475569"
)

# 2. ROW 2: Data Sources & Processing (Split)
left_source = draw_card(
    ax, center_x=27, center_y=71, width=42, height=11.5,
    title="Multi-Tier Orbital DEM Tiles",
    subtitle="HiRISE (1 m) + CTX (20 m) + MOLA-HRSC (200 m)\nSeam-calibrated with 1.5 km smooth edge blend",
    bg_color="#F3F0FF", border_color="#C4B5FD",
    title_color="#4338CA", sub_color="#6366F1"
)

right_source = draw_card(
    ax, center_x=73, center_y=71, width=42, height=11.5,
    title="Skyline Angle Extraction",
    subtitle="backend/skyline: Column-wise horizon edge detection\nConverts pixels to world rays (azimuth & elevation)",
    bg_color="#ECFDF5", border_color="#A7F3D0",
    title_color="#065F46", sub_color="#059669"
)

# 3. ROW 3: Core Matching Engine
engine_card = draw_card(
    ax, center_x=50, center_y=50, width=54, height=12.0,
    title="MarsLoc Localization Engine",
    subtitle="Pass 1: Vectorized 2° coarse circular cross-correlation (all 22.8k positions)\nPass 2: Gaussian + Outlier mixture log-likelihood scoring",
    bg_color="#FFF1F2", border_color="#FECDD3",
    title_color="#9F1239", sub_color="#E11D48"
)

# 4. ROW 4: Refinement & Landmark Scoring
refine_card = draw_card(
    ax, center_x=50, center_y=30, width=54, height=11.5,
    title="Fine Search & Landmark Identification",
    subtitle="Hierarchical sub-pixel descent (12.5 m) with Mars curvature\nDominant distant feature named via IAU gazetteer",
    bg_color="#FFFBEB", border_color="#FDE68A",
    title_color="#92400E", sub_color="#D97706"
)

# 5. ROW 5: Dual Outputs
left_output = draw_card(
    ax, center_x=27, center_y=11, width=42, height=11.5,
    title="Interactive Jezero Map",
    subtitle="Best position fix, 68% & 95% uncertainty ellipses,\nlikelihood heatmap & camera heading wedge",
    bg_color="#F0F9FF", border_color="#BAE6FD",
    title_color="#0369A1", sub_color="#0284C7"
)

right_output = draw_card(
    ax, center_x=73, center_y=11, width=42, height=11.5,
    title="Synchronized HUD & Control",
    subtitle="Turn-by-turn Field HUD & Earth Control Station\nsynchronized across 11:20 Martian signal delay",
    bg_color="#F0F9FF", border_color="#BAE6FD",
    title_color="#0369A1", sub_color="#0284C7"
)

# Connect with Arrows
# Top -> Left Source, Top -> Right Source
draw_arrow(ax, (40, 84.5), (27, 77))
draw_arrow(ax, (60, 84.5), (73, 77))

# Left Source -> Engine, Right Source -> Engine
draw_arrow(ax, (27, 65), (42, 56.5))
draw_arrow(ax, (73, 65), (58, 56.5))

# Engine -> Refine
draw_arrow(ax, (50, 44), (50, 36))

# Refine -> Left Output, Refine -> Right Output
draw_arrow(ax, (42, 24), (27, 17))
draw_arrow(ax, (58, 24), (73, 17))

# Save output
out_repo = "architecture_workflow.png"
plt.tight_layout()
plt.savefig(out_repo, dpi=300, facecolor=fig.get_facecolor(), edgecolor="none")
print(f"Saved flowchart to {out_repo}")
