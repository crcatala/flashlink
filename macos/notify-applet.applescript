-- r2-fastlink notifier: the applet install.sh builds from this file with osacompile.
--
-- Why it exists: notifications posted by plain `osascript` belong to Script Editor, so clicking
-- one opens Script Editor's Open dialog. A notification posted from this applet belongs to the
-- applet ("r2-fastlink"), and a click just relaunches it with nothing to do, so it quits again.
--
-- Protocol: `r2fl up --notify` writes one file per notification into the "pending" folder next to
-- this app (line 1: subtitle, line 2: text; written under a dot name and renamed, so a file is
-- never half written) and then runs `open -g -j` on the app. The data is only ever read as text and
-- handed to `display notification`; it is never run as code.
--
-- A plain applet ignores a second `open` while it is still running (it is only "reopened"), so a
-- message that arrives mid-run would wait for the next launch. To avoid that the applet looks at
-- the folder again after a short pause and quits only after two empty looks. Messages older than
-- ten minutes are dropped unread, so a stranded one can never surface later as a stale link.
on run
	set appPath to POSIX path of (path to me)
	set pendingDir to (do shell script "dirname " & quoted form of appPath) & "/pending"
	try
		do shell script "find " & quoted form of pendingDir & " -type f -mmin +10 -delete"
	end try
	set quietLooks to 0
	set rounds to 0
	repeat while quietLooks < 2 and rounds < 50
		set rounds to rounds + 1
		if (my drainQueue(pendingDir)) > 0 then
			set quietLooks to 0
		else
			set quietLooks to quietLooks + 1
			delay 0.3
		end if
	end repeat
end run

-- Post and delete every message in the folder; returns how many were handled.
on drainQueue(pendingDir)
	set handled to 0
	try
		set names to paragraphs of (do shell script "ls -1 " & quoted form of pendingDir & " 2>/dev/null | sort")
	on error
		return 0
	end try
	repeat with n in names
		if (n as text) is not "" then
			set f to pendingDir & "/" & (n as text)
			try
				set txt to read (POSIX file f) as «class utf8»
				do shell script "rm -f " & quoted form of f
				set parts to paragraphs of txt
				set subtitleText to ""
				set bodyText to ""
				if (count of parts) ≥ 1 then set subtitleText to item 1 of parts
				if (count of parts) ≥ 2 then set bodyText to item 2 of parts
				display notification bodyText with title "r2-fastlink" subtitle subtitleText
				set handled to handled + 1
			end try
		end if
	end repeat
	return handled
end drainQueue
