$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\chat-avatars"
[System.IO.Directory]::CreateDirectory($outDir) | Out-Null

$size = 256
$center = [System.Drawing.PointF]::new($size / 2, $size / 2)

function New-Color([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function Pt([double]$x, [double]$y) {
  return [System.Drawing.PointF]::new([float]$x, [float]$y)
}

function New-Rect([double]$x, [double]$y, [double]$w, [double]$h) {
  return [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$w, [float]$h)
}

function Fill-EllipseGradient($g, $rect, $centerColor, $edgeColor) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($rect)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $centerColor
  $brush.SurroundColors = [System.Drawing.Color[]]@($edgeColor)
  $g.FillEllipse($brush, $rect)
  $brush.Dispose()
  $path.Dispose()
}

function Draw-Polygon($g, [System.Drawing.PointF[]]$points, $fillColor, $outlineColor, [float]$stroke = 5) {
  $shadow = New-Object System.Drawing.SolidBrush (New-Color 6 10 20 70)
  $offset = foreach ($p in $points) { Pt ($p.X + 2) ($p.Y + 4) }
  $g.FillPolygon($shadow, $offset)
  $shadow.Dispose()

  $fill = New-Object System.Drawing.SolidBrush $fillColor
  $pen = New-Object System.Drawing.Pen($outlineColor, $stroke)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.FillPolygon($fill, $points)
  $g.DrawPolygon($pen, $points)
  $fill.Dispose()
  $pen.Dispose()
}

function Draw-Line($g, $x1, $y1, $x2, $y2, $color, [float]$width = 8) {
  $pen = New-Object System.Drawing.Pen($color, $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($pen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
  $pen.Dispose()
}

function Draw-Circle($g, $x, $y, $r, $fillColor, $outlineColor = $null, [float]$stroke = 4) {
  $rect = New-Rect ($x - $r) ($y - $r) ($r * 2) ($r * 2)
  $fill = New-Object System.Drawing.SolidBrush $fillColor
  $g.FillEllipse($fill, $rect)
  $fill.Dispose()
  if ($outlineColor) {
    $pen = New-Object System.Drawing.Pen($outlineColor, $stroke)
    $g.DrawEllipse($pen, $rect)
    $pen.Dispose()
  }
}

function Draw-BadgeBase($g, $theme) {
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  Fill-EllipseGradient $g (New-Rect 20 22 216 216) $theme.glowSoft $theme.glowOuter
  Fill-EllipseGradient $g (New-Rect 30 30 196 196) $theme.rimBright $theme.rimDark
  Fill-EllipseGradient $g (New-Rect 42 42 172 172) $theme.coreBright $theme.coreDark
  Fill-EllipseGradient $g (New-Rect 54 54 148 148) (New-Color 255 255 255 36) (New-Color 255 255 255 0)

  $penOuter = New-Object System.Drawing.Pen($theme.rimLine, 3)
  $penInner = New-Object System.Drawing.Pen((New-Color 255 255 255 34), 2)
  $g.DrawEllipse($penOuter, (New-Rect 31 31 194 194))
  $g.DrawEllipse($penInner, (New-Rect 43 43 170 170))
  $penOuter.Dispose()
  $penInner.Dispose()

  $gloss = New-Object System.Drawing.SolidBrush (New-Color 255 255 255 36)
  $g.FillEllipse($gloss, (New-Rect 62 54 132 54))
  $gloss.Dispose()

  Draw-Circle $g 192 68 6 (New-Color 255 255 255 188)
  Draw-Circle $g 72 94 4 (New-Color 255 255 255 110)
  Draw-Circle $g 174 88 3 (New-Color 255 255 255 78)
}

function Draw-Helmet($g, $theme) {
  $fill = $theme.iconFill
  $shadow = New-Color 6 10 24 95
  $outline = $theme.iconOutline
  $brush = New-Object System.Drawing.SolidBrush $shadow
  $g.FillPie($brush, 78, 78, 100, 88, 180, 180)
  $g.FillRectangle($brush, 88, 120, 80, 18)
  $g.FillRectangle($brush, 118, 90, 20, 26)
  $brush.Dispose()

  $brush = New-Object System.Drawing.SolidBrush $fill
  $g.FillPie($brush, 74, 72, 104, 90, 180, 180)
  $g.FillRectangle($brush, 84, 116, 88, 20)
  $g.FillRectangle($brush, 118, 86, 20, 28)
  $brush.Dispose()
  Draw-Line $g 90 138 166 138 $outline 6
}

function Draw-Pickaxes($g, $theme) {
  Draw-Line $g 92 168 168 92 (New-Color 115 70 32) 10
  Draw-Line $g 92 92 168 168 (New-Color 115 70 32) 10
  Draw-Line $g 92 168 168 92 (New-Color 212 167 102) 4
  Draw-Line $g 92 92 168 168 (New-Color 212 167 102) 4

  Draw-Polygon $g @(
    (Pt 74 96), (Pt 100 78), (Pt 124 92), (Pt 102 108)
  ) $theme.iconFill $theme.iconOutline 4
  Draw-Polygon $g @(
    (Pt 160 78), (Pt 186 96), (Pt 158 108), (Pt 138 92)
  ) $theme.iconFill $theme.iconOutline 4
}

function Draw-Crystal($g, $theme) {
  Draw-Polygon $g @((Pt 128 58), (Pt 150 92), (Pt 128 170), (Pt 106 92)) $theme.iconFill $theme.iconOutline 4
  Draw-Polygon $g @((Pt 92 88), (Pt 112 110), (Pt 100 162), (Pt 76 120)) (New-Color 233 221 255) $theme.iconOutline 4
  Draw-Polygon $g @((Pt 164 88), (Pt 180 120), (Pt 156 162), (Pt 144 110)) (New-Color 241 231 255) $theme.iconOutline 4
  Draw-Line $g 128 58 128 170 (New-Color 255 255 255 90) 3
  Draw-Line $g 106 92 150 92 (New-Color 255 255 255 72) 3
}

function Draw-Cart($g, $theme) {
  $shadow = New-Object System.Drawing.SolidBrush (New-Color 7 10 22 80)
  $g.FillRectangle($shadow, 77, 101, 104, 12)
  $shadow.Dispose()
  Draw-Polygon $g @((Pt 76 96), (Pt 184 96), (Pt 170 142), (Pt 88 142)) $theme.iconFill $theme.iconOutline 5
  Draw-Line $g 70 96 190 96 (New-Color 255 255 255 90) 4
  Draw-Circle $g 100 156 12 (New-Color 218 230 255) $theme.iconOutline 4
  Draw-Circle $g 156 156 12 (New-Color 218 230 255) $theme.iconOutline 4
}

function Draw-Dynamite($g, $theme) {
  foreach ($x in 92, 124, 156) {
    $brush = New-Object System.Drawing.SolidBrush $theme.iconFill
    $g.FillRectangle($brush, $x, 92, 18, 74)
    $brush.Dispose()
    $band = New-Object System.Drawing.SolidBrush (New-Color 255 244 220 48)
    $g.FillRectangle($band, $x, 110, 18, 8)
    $band.Dispose()
  }
  Draw-Line $g 168 92 190 66 (New-Color 232 220 180) 4
  Draw-Circle $g 196 58 8 (New-Color 255 210 120) (New-Color 255 245 210) 3
}

function Draw-Ingot($g, $theme) {
  Draw-Polygon $g @((Pt 86 142), (Pt 108 100), (Pt 148 100), (Pt 170 142)) $theme.iconFill $theme.iconOutline 5
  Draw-Line $g 98 122 158 122 (New-Color 255 255 255 92) 4
}

function Draw-Torch($g, $theme) {
  $brush = New-Object System.Drawing.SolidBrush (New-Color 131 80 32)
  $g.FillRectangle($brush, 121, 104, 14, 70)
  $brush.Dispose()
  Draw-Line $g 121 126 135 126 (New-Color 220 170 108) 4
  Draw-Line $g 121 146 135 146 (New-Color 220 170 108) 4
  Draw-Polygon $g @((Pt 128 66), (Pt 150 104), (Pt 128 118), (Pt 106 104)) $theme.iconFill $theme.iconOutline 4
  Draw-Polygon $g @((Pt 128 82), (Pt 140 104), (Pt 128 110), (Pt 116 104)) (New-Color 255 241 185) (New-Color 255 252 235 120) 2
}

function Draw-Drill($g, $theme) {
  Draw-Polygon $g @((Pt 92 110), (Pt 154 110), (Pt 186 128), (Pt 154 146), (Pt 92 146)) $theme.iconFill $theme.iconOutline 5
  $brush = New-Object System.Drawing.SolidBrush (New-Color 85 104 160)
  $g.FillRectangle($brush, 76, 98, 16, 60)
  $brush.Dispose()
  Draw-Line $g 154 110 194 128 (New-Color 255 255 255 110) 4
  Draw-Line $g 154 146 194 128 (New-Color 220 236 255 80) 4
}

function Draw-Diamond($g, $theme) {
  Draw-Polygon $g @((Pt 128 68), (Pt 184 128), (Pt 128 188), (Pt 72 128)) $theme.iconFill $theme.iconOutline 5
  Draw-Line $g 128 68 128 188 (New-Color 255 255 255 100) 4
  Draw-Line $g 72 128 184 128 (New-Color 255 255 255 84) 4
  Draw-Line $g 96 96 128 128 (New-Color 255 255 255 64) 3
  Draw-Line $g 160 96 128 128 (New-Color 255 255 255 64) 3
}

function Draw-Ember($g, $theme) {
  Draw-Polygon $g @((Pt 128 70), (Pt 175 128), (Pt 128 184), (Pt 82 128)) $theme.iconFill $theme.iconOutline 5
  Draw-Polygon $g @((Pt 128 96), (Pt 150 128), (Pt 128 156), (Pt 108 128)) (New-Color 255 224 190) (New-Color 255 245 225 100) 2
}

function Draw-Shield($g, $theme) {
  Draw-Polygon $g @((Pt 128 72), (Pt 172 90), (Pt 166 140), (Pt 128 184), (Pt 90 140), (Pt 84 90)) $theme.iconFill $theme.iconOutline 5
  Draw-Line $g 128 92 128 162 (New-Color 255 255 255 88) 4
  Draw-Line $g 102 118 154 118 (New-Color 255 255 255 88) 4
}

function Draw-Potion($g, $theme) {
  Draw-Line $g 116 74 140 74 (New-Color 255 255 255 92) 5
  Draw-Polygon $g @((Pt 116 74), (Pt 116 100), (Pt 98 126), (Pt 108 168), (Pt 148 168), (Pt 158 126), (Pt 140 100), (Pt 140 74)) $theme.iconFill $theme.iconOutline 5
  Draw-Line $g 102 138 154 138 (New-Color 255 255 255 88) 4
  Draw-Circle $g 114 146 4 (New-Color 255 255 255 100)
  Draw-Circle $g 138 154 3 (New-Color 255 255 255 86)
}

function Draw-Eye($g, $theme) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddBezier((Pt 74 128), (Pt 100 92), (Pt 156 92), (Pt 182 128))
  $path.AddBezier((Pt 182 128), (Pt 156 164), (Pt 100 164), (Pt 74 128))
  $brush = New-Object System.Drawing.SolidBrush $theme.iconFill
  $pen = New-Object System.Drawing.Pen($theme.iconOutline, 5)
  $g.FillPath($brush, $path)
  $g.DrawPath($pen, $path)
  $brush.Dispose()
  $pen.Dispose()
  $path.Dispose()
  Draw-Circle $g 128 128 24 (New-Color 33 44 72) $theme.iconOutline 4
  Draw-Circle $g 128 128 10 (New-Color 255 243 200)
  Draw-Circle $g 136 118 4 (New-Color 255 255 255 200)
}

function Draw-Crown($g, $theme) {
  Draw-Polygon $g @((Pt 82 164), (Pt 96 94), (Pt 128 130), (Pt 160 94), (Pt 174 164)) $theme.iconFill $theme.iconOutline 5
  Draw-Line $g 84 164 172 164 (New-Color 255 255 255 86) 4
  Draw-Circle $g 96 94 6 (New-Color 255 226 252)
  Draw-Circle $g 128 130 6 (New-Color 255 226 252)
  Draw-Circle $g 160 94 6 (New-Color 255 226 252)
}

function Draw-Skull($g, $theme) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(86, 82, 84, 74, 180, 180)
  $path.AddLine(170, 119, 170, 146)
  $path.AddLine(170, 146, 86, 146)
  $path.AddLine(86, 146, 86, 119)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush $theme.iconFill
  $pen = New-Object System.Drawing.Pen($theme.iconOutline, 5)
  $g.FillPath($brush, $path)
  $g.DrawPath($pen, $path)
  $brush.Dispose()
  $pen.Dispose()
  $path.Dispose()
  Draw-Circle $g 108 118 12 (New-Color 18 24 44)
  Draw-Circle $g 148 118 12 (New-Color 18 24 44)
  $teeth = New-Object System.Drawing.SolidBrush (New-Color 18 24 44)
  $g.FillRectangle($teeth, 116, 138, 24, 12)
  $teeth.Dispose()
}

function Draw-Lantern($g, $theme) {
  Draw-Line $g 112 82 144 82 (New-Color 255 245 220 92) 4
  Draw-Line $g 118 82 118 100 (New-Color 255 245 220 92) 4
  Draw-Line $g 138 82 138 100 (New-Color 255 245 220 92) 4
  Draw-Polygon $g @((Pt 106 100), (Pt 150 100), (Pt 144 158), (Pt 112 158)) $theme.iconFill $theme.iconOutline 5
  Draw-Circle $g 128 129 16 (New-Color 255 241 192) (New-Color 255 250 224 140) 2
}

function Draw-Symbol($g, $symbol, $theme) {
  switch ($symbol) {
    "helmet" { Draw-Helmet $g $theme }
    "pickaxes" { Draw-Pickaxes $g $theme }
    "crystal" { Draw-Crystal $g $theme }
    "cart" { Draw-Cart $g $theme }
    "dynamite" { Draw-Dynamite $g $theme }
    "ingot" { Draw-Ingot $g $theme }
    "torch" { Draw-Torch $g $theme }
    "drill" { Draw-Drill $g $theme }
    "diamond" { Draw-Diamond $g $theme }
    "ember" { Draw-Ember $g $theme }
    "shield" { Draw-Shield $g $theme }
    "potion" { Draw-Potion $g $theme }
    "eye" { Draw-Eye $g $theme }
    "crown" { Draw-Crown $g $theme }
    "skull" { Draw-Skull $g $theme }
    "lantern" { Draw-Lantern $g $theme }
  }
}

$themes = @{
  "miner-helmet" = @{ symbol = "helmet"; glowSoft = (New-Color 108 255 202 48); glowOuter = (New-Color 108 255 202 0); rimBright = (New-Color 252 255 255 235); rimDark = (New-Color 126 255 202 86); rimLine = (New-Color 255 255 255 76); coreBright = (New-Color 144 255 191); coreDark = (New-Color 18 60 48); iconFill = (New-Color 234 255 245); iconOutline = (New-Color 18 45 40) }
  "crossed-picks" = @{ symbol = "pickaxes"; glowSoft = (New-Color 255 212 110 52); glowOuter = (New-Color 255 212 110 0); rimBright = (New-Color 255 250 230 235); rimDark = (New-Color 255 199 102 84); rimLine = (New-Color 255 252 242 76); coreBright = (New-Color 242 189 76); coreDark = (New-Color 82 48 16); iconFill = (New-Color 255 246 222); iconOutline = (New-Color 67 41 11) }
  "crystal-cluster" = @{ symbol = "crystal"; glowSoft = (New-Color 246 141 255 54); glowOuter = (New-Color 246 141 255 0); rimBright = (New-Color 255 246 255 235); rimDark = (New-Color 227 124 255 84); rimLine = (New-Color 255 248 255 80); coreBright = (New-Color 220 120 255); coreDark = (New-Color 72 24 103); iconFill = (New-Color 252 236 255); iconOutline = (New-Color 62 21 88) }
  "mine-cart" = @{ symbol = "cart"; glowSoft = (New-Color 133 203 255 52); glowOuter = (New-Color 133 203 255 0); rimBright = (New-Color 244 249 255 235); rimDark = (New-Color 132 178 255 80); rimLine = (New-Color 242 247 255 78); coreBright = (New-Color 98 143 255); coreDark = (New-Color 26 54 115); iconFill = (New-Color 236 244 255); iconOutline = (New-Color 20 38 82) }
  "dynamite" = @{ symbol = "dynamite"; glowSoft = (New-Color 255 122 122 54); glowOuter = (New-Color 255 122 122 0); rimBright = (New-Color 255 242 242 235); rimDark = (New-Color 255 145 145 84); rimLine = (New-Color 255 246 246 72); coreBright = (New-Color 245 84 84); coreDark = (New-Color 116 22 28); iconFill = (New-Color 255 235 235); iconOutline = (New-Color 82 16 21) }
  "gold-ingot" = @{ symbol = "ingot"; glowSoft = (New-Color 255 216 92 54); glowOuter = (New-Color 255 216 92 0); rimBright = (New-Color 255 250 224 235); rimDark = (New-Color 255 210 108 86); rimLine = (New-Color 255 248 224 76); coreBright = (New-Color 247 187 46); coreDark = (New-Color 122 78 8); iconFill = (New-Color 255 247 219); iconOutline = (New-Color 89 55 5) }
  "wall-torch" = @{ symbol = "torch"; glowSoft = (New-Color 255 170 105 58); glowOuter = (New-Color 255 170 105 0); rimBright = (New-Color 255 244 230 235); rimDark = (New-Color 255 163 95 88); rimLine = (New-Color 255 245 236 72); coreBright = (New-Color 236 114 35); coreDark = (New-Color 116 37 10); iconFill = (New-Color 255 239 221); iconOutline = (New-Color 82 27 8) }
  "drill-bit" = @{ symbol = "drill"; glowSoft = (New-Color 122 184 255 52); glowOuter = (New-Color 122 184 255 0); rimBright = (New-Color 242 248 255 235); rimDark = (New-Color 113 158 255 84); rimLine = (New-Color 242 247 255 76); coreBright = (New-Color 63 112 253); coreDark = (New-Color 22 37 111); iconFill = (New-Color 237 245 255); iconOutline = (New-Color 18 30 76) }
  "mega-diamond" = @{ symbol = "diamond"; glowSoft = (New-Color 120 243 255 54); glowOuter = (New-Color 120 243 255 0); rimBright = (New-Color 243 254 255 235); rimDark = (New-Color 111 232 255 84); rimLine = (New-Color 244 255 255 80); coreBright = (New-Color 58 192 255); coreDark = (New-Color 19 95 146); iconFill = (New-Color 238 255 255); iconOutline = (New-Color 16 62 97) }
  "fire-gem" = @{ symbol = "ember"; glowSoft = (New-Color 255 151 100 58); glowOuter = (New-Color 255 151 100 0); rimBright = (New-Color 255 244 230 235); rimDark = (New-Color 255 158 104 88); rimLine = (New-Color 255 245 235 76); coreBright = (New-Color 247 120 47); coreDark = (New-Color 134 55 7); iconFill = (New-Color 255 239 228); iconOutline = (New-Color 92 40 5) }
  "shield-pick" = @{ symbol = "shield"; glowSoft = (New-Color 167 181 255 50); glowOuter = (New-Color 167 181 255 0); rimBright = (New-Color 244 246 255 235); rimDark = (New-Color 162 174 255 82); rimLine = (New-Color 248 249 255 76); coreBright = (New-Color 114 134 255); coreDark = (New-Color 41 57 136); iconFill = (New-Color 242 246 255); iconOutline = (New-Color 33 46 97) }
  "potion" = @{ symbol = "potion"; glowSoft = (New-Color 146 255 169 52); glowOuter = (New-Color 146 255 169 0); rimBright = (New-Color 246 255 247 235); rimDark = (New-Color 145 255 180 80); rimLine = (New-Color 246 255 249 76); coreBright = (New-Color 71 190 91); coreDark = (New-Color 22 76 37); iconFill = (New-Color 238 255 241); iconOutline = (New-Color 19 55 31) }
  "dragon-eye" = @{ symbol = "eye"; glowSoft = (New-Color 255 198 122 54); glowOuter = (New-Color 255 198 122 0); rimBright = (New-Color 255 248 236 235); rimDark = (New-Color 255 194 117 84); rimLine = (New-Color 255 248 236 74); coreBright = (New-Color 232 128 26); coreDark = (New-Color 112 56 6); iconFill = (New-Color 255 244 227); iconOutline = (New-Color 78 39 5) }
  "crown-gems" = @{ symbol = "crown"; glowSoft = (New-Color 219 166 255 56); glowOuter = (New-Color 219 166 255 0); rimBright = (New-Color 250 244 255 235); rimDark = (New-Color 215 159 255 86); rimLine = (New-Color 251 246 255 78); coreBright = (New-Color 157 86 255); coreDark = (New-Color 70 28 130); iconFill = (New-Color 247 236 255); iconOutline = (New-Color 51 22 92) }
  "skull" = @{ symbol = "skull"; glowSoft = (New-Color 182 191 224 48); glowOuter = (New-Color 182 191 224 0); rimBright = (New-Color 246 248 255 235); rimDark = (New-Color 186 194 230 80); rimLine = (New-Color 246 248 255 74); coreBright = (New-Color 109 121 174); coreDark = (New-Color 43 53 92); iconFill = (New-Color 244 246 255); iconOutline = (New-Color 36 43 71) }
  "lantern-glow" = @{ symbol = "lantern"; glowSoft = (New-Color 255 208 130 58); glowOuter = (New-Color 255 208 130 0); rimBright = (New-Color 255 247 230 235); rimDark = (New-Color 255 211 145 86); rimLine = (New-Color 255 247 234 78); coreBright = (New-Color 226 149 35); coreDark = (New-Color 120 70 10); iconFill = (New-Color 255 244 222); iconOutline = (New-Color 83 48 7) }
}

foreach ($entry in $themes.GetEnumerator()) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    Draw-BadgeBase $g $entry.Value
    Draw-Symbol $g $entry.Value.symbol $entry.Value
    $path = Join-Path $outDir "$($entry.Key).png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $path
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}
