using System.Globalization;
using MeetingLive.Core.Strings;

namespace MeetingLive.Core.Tests.Strings;

[Collection(nameof(CoreStringsTests))]
public class CoreStringsTests
{
    [Fact]
    public void Get_UnderEnglishCulture_ReturnsEnglishText()
    {
        var original = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("en-US");

            var result = CoreStrings.Get("Sample_Greeting");

            Assert.Equal("Hello", result);
        }
        finally
        {
            CultureInfo.CurrentUICulture = original;
        }
    }

    [Fact]
    public void Get_UnderSpanishCulture_ReturnsSpanishText()
    {
        var original = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("es");

            var result = CoreStrings.Get("Sample_Greeting");

            Assert.Equal("Hola", result);
        }
        finally
        {
            CultureInfo.CurrentUICulture = original;
        }
    }
}
