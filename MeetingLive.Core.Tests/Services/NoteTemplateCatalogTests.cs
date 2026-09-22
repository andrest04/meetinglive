using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class NoteTemplateCatalogTests
{
    [Fact]
    public void InstructionsFor_AutoAndUnknown_ReturnNull()
    {
        Assert.Null(NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.AutoId));
        Assert.Null(NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.CustomId));
        Assert.Null(NoteTemplateCatalog.InstructionsFor(null));
        Assert.Null(NoteTemplateCatalog.InstructionsFor("not-a-template"));
    }

    [Fact]
    public void InstructionsFor_BuiltIns_NameTheRequiredShape()
    {
        Assert.Contains("decisions", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.OneOnOneId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("feedback", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.OneOnOneId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("commitments", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.OneOnOneId), StringComparison.OrdinalIgnoreCase);

        Assert.Contains("yesterday", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.StandupId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("today", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.StandupId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("blockers", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.StandupId), StringComparison.OrdinalIgnoreCase);

        Assert.Contains("pain", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.SalesId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("decision process", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.SalesId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("next step", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.SalesId), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("objections", NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.SalesId), StringComparison.OrdinalIgnoreCase);

        var interview = NoteTemplateCatalog.InstructionsFor(NoteTemplateCatalog.UserInterviewId);
        Assert.Contains("what they tried", interview, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("quotes", interview, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("jobs-to-be-done", interview, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not invent quotes", interview, StringComparison.Ordinal);
    }

    [Fact]
    public void NormalizeId_OmitsAutoAndBlank()
    {
        Assert.Null(NoteTemplateCatalog.NormalizeId(null));
        Assert.Null(NoteTemplateCatalog.NormalizeId("  "));
        Assert.Null(NoteTemplateCatalog.NormalizeId("auto"));
        Assert.Equal("standup", NoteTemplateCatalog.NormalizeId(" standup "));
    }
}
