using System.Drawing;
using System.Drawing.Drawing2D;

// Знаки поставщиков воспроизводятся в исходных пропорциях для подписей квот.
// Blossom принадлежит OpenAI: https://openai.com/brand/
// Контур Blossom_Light.svg: https://wyrd.foo/assets/codex-cli/logo.svg (только исходный чёрный path).
// Antigravity принадлежит Google: https://antigravity.google/press
// Контур Icon - White: https://antigravity.google/assets/image/brand/antigravity-icon__white.svg
static class QuotaGlyphs
{
    private static readonly RectangleF BlossomBounds = new RectangleF(146.69f, 227.04f, 267.21f, 264.82f);
    private static readonly RectangleF AntigravityBounds = new RectangleF(22.50f, 28.12f, 134.34f, 123.76f);

    public static void Draw(Graphics graphics, RectangleF bounds, bool antigravity, Color color)
    {
        if (bounds.Width <= 0 || bounds.Height <= 0) return;

        using (var contour = antigravity ? CreateAntigravity() : CreateBlossom())
        using (var brush = new SolidBrush(color))
        {
            var source = antigravity ? AntigravityBounds : BlossomBounds;
            var scale = System.Math.Min(bounds.Width / source.Width, bounds.Height / source.Height);
            var x = bounds.X + (bounds.Width - source.Width * scale) / 2 - source.X * scale;
            var y = bounds.Y + (bounds.Height - source.Height * scale) / 2 - source.Y * scale;
            using (var placement = new Matrix(scale, 0, 0, scale, x, y))
            {
                contour.Transform(placement);
            }

            var previous = graphics.Save();
            try
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.FillPath(brush, contour);
            }
            finally
            {
                graphics.Restore(previous);
            }
        }
    }

    private static GraphicsPath CreateBlossom()
    {
        var contour = new GraphicsPath(FillMode.Winding);
        contour.StartFigure();
        contour.AddLine(249.176f, 323.434f, 249.176f, 298.276f);
        contour.AddBezier(249.176f, 298.276f, 249.176f, 296.158f, 249.971f, 294.569f, 251.825f, 293.509f);
        contour.AddLine(251.825f, 293.509f, 302.406f, 264.381f);
        contour.AddBezier(302.406f, 264.381f, 309.29f, 260.409f, 317.5f, 258.555f, 325.973f, 258.555f);
        contour.AddBezier(325.973f, 258.555f, 357.75f, 258.555f, 377.877f, 283.185f, 377.877f, 309.399f);
        contour.AddBezier(377.877f, 309.399f, 377.877f, 311.253f, 377.877f, 313.371f, 377.611f, 315.49f);
        contour.AddLine(377.611f, 315.49f, 325.178f, 284.771f);
        contour.AddBezier(325.178f, 284.771f, 322.001f, 282.919f, 318.822f, 282.919f, 315.645f, 284.771f);
        contour.AddLine(315.645f, 284.771f, 249.176f, 323.434f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddLine(367.283f, 421.415f, 367.283f, 361.301f);
        contour.AddBezier(367.283f, 361.301f, 367.283f, 357.592f, 365.694f, 354.945f, 362.516f, 353.092f);
        contour.AddLine(362.516f, 353.092f, 296.048f, 314.43f);
        contour.AddLine(296.048f, 314.43f, 317.763f, 301.982f);
        contour.AddBezier(317.763f, 301.982f, 319.617f, 300.925f, 321.206f, 300.925f, 323.058f, 301.982f);
        contour.AddLine(323.058f, 301.982f, 373.639f, 331.112f);
        contour.AddBezier(373.639f, 331.112f, 388.205f, 339.586f, 398.003f, 357.592f, 398.003f, 375.069f);
        contour.AddBezier(398.003f, 375.069f, 398.003f, 395.195f, 386.087f, 413.733f, 367.283f, 421.412f);
        contour.AddLine(367.283f, 421.412f, 367.283f, 421.415f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddLine(233.553f, 368.452f, 211.838f, 355.742f);
        contour.AddBezier(211.838f, 355.742f, 209.986f, 354.684f, 209.19f, 353.095f, 209.19f, 350.975f);
        contour.AddLine(209.19f, 350.975f, 209.19f, 292.718f);
        contour.AddBezier(209.19f, 292.718f, 209.19f, 264.383f, 230.905f, 242.932f, 260.301f, 242.932f);
        contour.AddBezier(260.301f, 242.932f, 271.423f, 242.932f, 281.748f, 246.641f, 290.49f, 253.26f);
        contour.AddLine(290.49f, 253.26f, 238.321f, 283.449f);
        contour.AddBezier(238.321f, 283.449f, 235.146f, 285.303f, 233.555f, 287.951f, 233.555f, 291.659f);
        contour.AddLine(233.555f, 291.659f, 233.555f, 368.455f);
        contour.AddLine(233.555f, 368.455f, 233.553f, 368.452f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddLine(280.292f, 395.462f, 249.176f, 377.985f);
        contour.AddLine(249.176f, 377.985f, 249.176f, 340.913f);
        contour.AddLine(249.176f, 340.913f, 280.292f, 323.436f);
        contour.AddLine(280.292f, 323.436f, 311.407f, 340.913f);
        contour.AddLine(311.407f, 340.913f, 311.407f, 377.985f);
        contour.AddLine(311.407f, 377.985f, 280.292f, 395.462f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddBezier(300.286f, 475.968f, 289.163f, 475.968f, 278.837f, 472.259f, 270.097f, 465.64f);
        contour.AddLine(270.097f, 465.64f, 322.264f, 435.449f);
        contour.AddBezier(322.264f, 435.449f, 325.441f, 433.597f, 327.03f, 430.949f, 327.03f, 427.239f);
        contour.AddLine(327.03f, 427.239f, 327.03f, 350.445f);
        contour.AddLine(327.03f, 350.445f, 349.011f, 363.155f);
        contour.AddBezier(349.011f, 363.155f, 350.865f, 364.213f, 351.66f, 365.802f, 351.66f, 367.922f);
        contour.AddLine(351.66f, 367.922f, 351.66f, 426.179f);
        contour.AddBezier(351.66f, 426.179f, 351.66f, 454.514f, 329.679f, 475.965f, 300.286f, 475.965f);
        contour.AddLine(300.286f, 475.965f, 300.286f, 475.968f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddLine(237.525f, 416.915f, 186.944f, 387.785f);
        contour.AddBezier(186.944f, 387.785f, 172.378f, 379.31f, 162.582f, 361.305f, 162.582f, 343.827f);
        contour.AddBezier(162.582f, 343.827f, 162.582f, 323.436f, 174.763f, 305.164f, 193.563f, 297.485f);
        contour.AddLine(193.563f, 297.485f, 193.563f, 357.861f);
        contour.AddBezier(193.563f, 357.861f, 193.563f, 361.571f, 195.154f, 364.217f, 198.33f, 366.071f);
        contour.AddLine(198.33f, 366.071f, 264.535f, 404.467f);
        contour.AddLine(264.535f, 404.467f, 242.82f, 416.915f);
        contour.AddBezier(242.82f, 416.915f, 240.967f, 417.972f, 239.377f, 417.972f, 237.525f, 416.915f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddBezier(234.614f, 460.343f, 204.689f, 460.343f, 182.71f, 437.833f, 182.71f, 410.028f);
        contour.AddBezier(182.71f, 410.028f, 182.71f, 407.91f, 182.976f, 405.792f, 183.238f, 403.672f);
        contour.AddLine(183.238f, 403.672f, 235.405f, 433.863f);
        contour.AddBezier(235.405f, 433.863f, 238.582f, 435.715f, 241.763f, 435.715f, 244.938f, 433.863f);
        contour.AddLine(244.938f, 433.863f, 311.407f, 395.466f);
        contour.AddLine(311.407f, 395.466f, 311.407f, 420.622f);
        contour.AddBezier(311.407f, 420.622f, 311.407f, 422.742f, 310.612f, 424.331f, 308.758f, 425.389f);
        contour.AddLine(308.758f, 425.389f, 258.179f, 454.519f);
        contour.AddBezier(258.179f, 454.519f, 251.293f, 458.491f, 243.083f, 460.343f, 234.611f, 460.343f);
        contour.AddLine(234.611f, 460.343f, 234.614f, 460.343f);
        contour.CloseFigure();
        contour.StartFigure();
        contour.AddBezier(300.286f, 491.854f, 332.329f, 491.854f, 359.073f, 469.082f, 365.167f, 438.892f);
        contour.AddBezier(365.167f, 438.892f, 394.825f, 431.211f, 413.892f, 403.406f, 413.892f, 375.073f);
        contour.AddBezier(413.892f, 375.073f, 413.892f, 356.535f, 405.948f, 338.529f, 391.648f, 325.552f);
        contour.AddBezier(391.648f, 325.552f, 392.972f, 319.991f, 393.766f, 314.43f, 393.766f, 308.87f);
        contour.AddBezier(393.766f, 308.87f, 393.766f, 271.003f, 363.048f, 242.666f, 327.562f, 242.666f);
        contour.AddBezier(327.562f, 242.666f, 320.413f, 242.666f, 313.528f, 243.723f, 306.644f, 246.109f);
        contour.AddBezier(306.644f, 246.109f, 294.725f, 234.457f, 278.307f, 227.042f, 260.301f, 227.042f);
        contour.AddBezier(260.301f, 227.042f, 228.258f, 227.042f, 201.513f, 249.815f, 195.42f, 280.004f);
        contour.AddBezier(195.42f, 280.004f, 165.761f, 287.685f, 146.694f, 315.49f, 146.694f, 343.824f);
        contour.AddBezier(146.694f, 343.824f, 146.694f, 362.362f, 154.638f, 380.368f, 168.938f, 393.344f);
        contour.AddBezier(168.938f, 393.344f, 167.613f, 398.906f, 166.819f, 404.467f, 166.819f, 410.027f);
        contour.AddBezier(166.819f, 410.027f, 166.819f, 447.894f, 197.538f, 476.231f, 233.024f, 476.231f);
        contour.AddBezier(233.024f, 476.231f, 240.172f, 476.231f, 247.058f, 475.173f, 253.943f, 472.788f);
        contour.AddBezier(253.943f, 472.788f, 265.859f, 484.441f, 282.278f, 491.854f, 300.286f, 491.854f);
        contour.CloseFigure();
        return contour;
    }

    private static GraphicsPath CreateAntigravity()
    {
        var contour = new GraphicsPath(FillMode.Winding);
        contour.StartFigure();
        contour.AddBezier(144.248f, 149.062f, 151.748f, 154.688f, 162.998f, 150.938f, 152.685f, 140.625f);
        contour.AddBezier(152.685f, 140.625f, 121.748f, 110.625f, 128.31f, 28.125f, 89.8727f, 28.125f);
        contour.AddBezier(89.8727f, 28.125f, 51.4352f, 28.125f, 57.9977f, 110.625f, 27.0602f, 140.625f);
        contour.AddBezier(27.0602f, 140.625f, 15.8102f, 151.875f, 27.9977f, 154.688f, 35.4977f, 149.062f);
        contour.AddBezier(35.4977f, 149.062f, 64.5602f, 129.375f, 62.6852f, 94.6875f, 89.8727f, 94.6875f);
        contour.AddBezier(89.8727f, 94.6875f, 117.06f, 94.6875f, 115.185f, 129.375f, 144.248f, 149.062f);
        contour.CloseFigure();
        return contour;
    }
}
